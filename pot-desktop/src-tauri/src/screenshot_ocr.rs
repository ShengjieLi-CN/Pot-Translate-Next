//! Local screenshot OCR. All returned coordinates refer to the original crop,
//! including after enlargement and overlapping tiles. No temporary crop files.
use image::{DynamicImage, GenericImageView, ImageFormat};
use serde_json::{json, Value};
use std::io::Cursor;
use windows::core::HSTRING;
use windows::Globalization::Language;
use windows::Graphics::Imaging::{BitmapAlphaMode, BitmapDecoder, BitmapPixelFormat};
use windows::Media::Ocr::{OcrEngine, OcrResult};
use windows::Storage::Streams::{DataWriter, InMemoryRandomAccessStream};

fn fail(e: windows::core::Error) -> String {
    e.to_string()
}

fn engine(lang: &str) -> Result<OcrEngine, String> {
    let result = if lang == "auto" {
        OcrEngine::TryCreateFromUserProfileLanguages()
    } else {
        OcrEngine::TryCreateFromLanguage(
            &Language::CreateLanguage(&HSTRING::from(lang)).map_err(fail)?,
        )
    };
    result.map_err(|_| {
        format!(
            "未安装对应的 Windows OCR 语言包：{lang}。请在 Windows 语言设置中安装文字识别功能。"
        )
    })
}

fn scan(image: &DynamicImage, engine: &OcrEngine) -> Result<OcrResult, String> {
    let mut png = Cursor::new(Vec::new());
    image
        .write_to(&mut png, ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    let stream = InMemoryRandomAccessStream::new().map_err(fail)?;
    let writer = DataWriter::CreateDataWriter(&stream).map_err(fail)?;
    writer.WriteBytes(png.get_ref()).map_err(fail)?;
    writer.StoreAsync().map_err(fail)?.get().map_err(fail)?;
    stream.Seek(0).map_err(fail)?;
    let decoder = BitmapDecoder::CreateAsync(&stream)
        .map_err(fail)?
        .get()
        .map_err(fail)?;
    let bitmap = decoder
        .GetSoftwareBitmapConvertedAsync(BitmapPixelFormat::Bgra8, BitmapAlphaMode::Ignore)
        .map_err(fail)?
        .get()
        .map_err(fail)?;
    engine
        .RecognizeAsync(&bitmap)
        .map_err(fail)?
        .get()
        .map_err(fail)
}

fn starts(length: u32, side: u32, overlap: u32) -> Vec<u32> {
    let mut values = vec![0];
    while values.last().unwrap() + side < length {
        values.push((values.last().unwrap() + side - overlap).min(length - side));
    }
    values
}

fn latin_and_cjk(text: &str) -> (usize, usize) {
    (
        text.chars().filter(|c| c.is_ascii_alphabetic()).count(),
        text.chars()
            .filter(|c| ('\u{3400}'..='\u{9fff}').contains(c))
            .count(),
    )
}

pub(super) fn recognize(bytes: &[u8], lang: &str) -> Result<Value, String> {
    let image = image::load_from_memory(bytes).map_err(|e| e.to_string())?;
    let (width, height) = image.dimensions();
    let primary = engine(lang)?;
    let english = if lang == "auto" {
        engine("en-US").ok()
    } else {
        None
    };
    let limit = OcrEngine::MaxImageDimension().map_err(fail)?;
    let scale = 2u32;
    // A white margin prevents OCR's internal edge rejection from losing complete
    // words near a selected edge. Tiles overlap so long lines survive seams.
    let padding = 16u32;
    let side = ((limit - padding * 2) / scale).min(1400);
    let mut lines = Vec::new();
    for top in starts(height, side, 96) {
        for left in starts(width, side, 96) {
            let tw = side.min(width - left);
            let th = side.min(height - top);
            let tile = image.crop_imm(left, top, tw, th);
            let mut gray = tile.to_luma8();
            // Normalise each tile independently; dark editor panels and pale
            // text on colour backgrounds should not become black-on-black.
            let dark = gray.pixels().filter(|p| p[0] < 110).count() > gray.len() * 3 / 5;
            if dark {
                image::imageops::invert(&mut gray);
            }
            let enlarged = image::imageops::resize(
                &gray,
                tw * scale,
                th * scale,
                image::imageops::FilterType::CatmullRom,
            );
            let mut padded = image::GrayImage::from_pixel(
                tw * scale + padding * 2,
                th * scale + padding * 2,
                image::Luma([255]),
            );
            image::imageops::replace(&mut padded, &enlarged, padding as i64, padding as i64);
            let processed = DynamicImage::ImageLuma8(padded);
            let mut result = scan(&processed, &primary)?;
            if let Some(english) = &english {
                let text = result.Text().map_err(fail)?.to_string_lossy();
                let (latin, cjk) = latin_and_cjk(&text);
                // The Chinese profile recognizer often reads small English as
                // Chinese glyphs. Only try English for Latin-dominant material;
                // retain the profile recognizer for Chinese/mixed documents.
                if latin >= 20 && latin > cjk * 3 {
                    if let Ok(alternative) = scan(&processed, english) {
                        let candidate = alternative.Text().map_err(fail)?.to_string_lossy();
                        if latin_and_cjk(&candidate).0 >= latin * 9 / 10 {
                            result = alternative;
                        }
                    }
                }
            }
            for line in result.Lines().map_err(fail)? {
                let mut words = Vec::new();
                for word in line.Words().map_err(fail)? {
                    let rect = word.BoundingRect().map_err(fail)?;
                    let x = (rect.X as f64 - padding as f64) / scale as f64;
                    let y = (rect.Y as f64 - padding as f64) / scale as f64;
                    let w = rect.Width as f64 / scale as f64;
                    let h = rect.Height as f64 / scale as f64;
                    // Ignore fragments cut by an internal tile edge. A complete
                    // copy is available in the neighbouring overlapping tile.
                    if (left > 0 && x < 1.0)
                        || (top > 0 && y < 1.0)
                        || (left + tw < width && x + w > tw as f64 - 1.0)
                        || (top + th < height && y + h > th as f64 - 1.0)
                    {
                        continue;
                    }
                    words.push(json!({"text": word.Text().map_err(fail)?.to_string_lossy(),
                        "box": {"x": x + left as f64, "y": y + top as f64, "width": w, "height": h}}));
                }
                if !words.is_empty() {
                    lines.push(json!({"text": words.iter().filter_map(|w| w["text"].as_str()).collect::<Vec<_>>().join(" "), "words": words}));
                }
            }
        }
    }
    Ok(json!({"width":width,"height":height,"lines":lines,"englishAvailable":english.is_some()}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn tiles_cover_large_images_with_overlap() {
        for length in [1, 100, 1400, 1401, 3072, 7680] {
            let positions = starts(length, 1400, 96);
            assert_eq!(positions[0], 0);
            assert!(positions.last().unwrap() + 1400 >= length);
            assert!(positions
                .windows(2)
                .all(|p| p[1] > p[0] && p[1] - p[0] <= 1304));
        }
    }
    #[test]
    #[ignore = "Requires a local image and installed Windows OCR language packs"]
    fn real_screenshot_ocr() {
        let input = std::env::var("POT_OCR_FIXTURE").expect("POT_OCR_FIXTURE");
        let result = recognize(&std::fs::read(input).unwrap(), "auto").unwrap();
        if let Ok(output) = std::env::var("POT_OCR_OUTPUT") {
            std::fs::write(output, serde_json::to_vec_pretty(&result).unwrap()).unwrap();
        }
        let text = result["lines"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|l| l["text"].as_str())
            .collect::<Vec<_>>()
            .join(" ");
        if let Ok(expected) = std::env::var("POT_OCR_EXPECT") {
            assert!(
                text.contains(&expected),
                "Expected phrase was not recognized"
            );
        }
        assert!(!text.is_empty());
    }
}
