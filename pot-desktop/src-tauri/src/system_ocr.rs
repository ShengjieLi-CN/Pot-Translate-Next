use dirs::cache_dir;

#[tauri::command(async)]
#[cfg(target_os = "windows")]
pub fn system_ocr(app_handle: tauri::AppHandle, lang: &str) -> Result<String, String> {
    windows_ocr_result(app_handle, lang)?
        .Text()
        .map(|text| text.to_string_lossy())
        .map_err(|e| e.to_string())
}

#[cfg(target_os = "windows")]
fn windows_ocr_result(
    app_handle: tauri::AppHandle,
    lang: &str,
) -> Result<windows::Media::Ocr::OcrResult, String> {
    use windows::core::HSTRING;
    use windows::Globalization::Language;
    use windows::Graphics::Imaging::BitmapDecoder;
    use windows::Media::Ocr::OcrEngine;
    use windows::Storage::{FileAccessMode, StorageFile};

    let mut app_cache_dir_path = cache_dir().expect("Get Cache Dir Failed");
    app_cache_dir_path.push(&app_handle.config().tauri.bundle.identifier);
    app_cache_dir_path.push("pot_screenshot_cut.png");

    let path = app_cache_dir_path.to_string_lossy().replace("\\\\?\\", "");

    let fail = |e: windows::core::Error| e.to_string();
    let file = StorageFile::GetFileFromPathAsync(&HSTRING::from(path))
        .map_err(fail)?
        .get()
        .map_err(fail)?;

    let bitmap = BitmapDecoder::CreateWithIdAsync(
        BitmapDecoder::PngDecoderId().map_err(fail)?,
        &file
            .OpenAsync(FileAccessMode::Read)
            .map_err(fail)?
            .get()
            .map_err(fail)?,
    )
    .map_err(fail)?
    .get()
    .map_err(fail)?;

    let bitmap = bitmap
        .GetSoftwareBitmapAsync()
        .map_err(fail)?
        .get()
        .map_err(fail)?;

    let engine = match lang {
        "auto" => OcrEngine::TryCreateFromUserProfileLanguages(),
        _ => {
            if let Ok(language) = Language::CreateLanguage(&HSTRING::from(lang)) {
                OcrEngine::TryCreateFromLanguage(&language)
            } else {
                return Err("Language Error".to_string());
            }
        }
    };

    match engine {
        Ok(v) => v.RecognizeAsync(&bitmap).map_err(fail)?.get().map_err(fail),
        Err(e) => {
            if e.to_string().contains("0x00000000") {
                Err("Language package not installed!\n\nSee: https://learn.microsoft.com/zh-cn/windows/powertoys/text-extractor#supported-languages".to_string())
            } else {
                Err(e.to_string())
            }
        }
    }
}

#[tauri::command(async)]
#[cfg(target_os = "windows")]
pub fn system_ocr_layout(
    app_handle: tauri::AppHandle,
    lang: &str,
) -> Result<serde_json::Value, String> {
    use serde_json::json;
    let result = windows_ocr_result(app_handle, lang)?;
    let fail = |e: windows::core::Error| e.to_string();
    let mut lines = Vec::new();
    for line in result.Lines().map_err(fail)? {
        let mut words = Vec::new();
        for word in line.Words().map_err(fail)? {
            let rect = word.BoundingRect().map_err(fail)?;
            words.push(json!({
                "text": word.Text().map_err(fail)?.to_string_lossy(),
                "box": { "x": rect.X, "y": rect.Y, "width": rect.Width, "height": rect.Height }
            }));
        }
        lines.push(json!({ "text": line.Text().map_err(fail)?.to_string_lossy(), "words": words }));
    }
    Ok(json!({ "text": result.Text().map_err(fail)?.to_string_lossy(), "lines": lines }))
}

#[tauri::command(async)]
#[cfg(not(target_os = "windows"))]
pub fn system_ocr_layout(
    app_handle: tauri::AppHandle,
    lang: &str,
) -> Result<serde_json::Value, String> {
    system_ocr(app_handle, lang).map(|text| serde_json::json!({ "text": text }))
}

#[tauri::command(async)]
#[cfg(target_os = "macos")]
pub fn system_ocr(app_handle: tauri::AppHandle, lang: &str) -> Result<String, String> {
    let mut app_cache_dir_path = cache_dir().expect("Get Cache Dir Failed");
    app_cache_dir_path.push(&app_handle.config().tauri.bundle.identifier);
    app_cache_dir_path.push("pot_screenshot_cut.png");

    let arch = std::env::consts::ARCH;
    let bin_path = match app_handle
        .path_resolver()
        .resolve_resource(format!("resources/ocr-{arch}-apple-darwin"))
    {
        Some(v) => v,
        None => return Err("Failed to resolve ocr binary".to_string()),
    };

    match std::process::Command::new("chmod")
        .arg("+x")
        .arg(bin_path.to_str().unwrap())
        .output()
    {
        Ok(_) => {}
        Err(e) => return Err(e.to_string()),
    }

    let output = match std::process::Command::new(bin_path)
        .arg(app_cache_dir_path.to_str().unwrap())
        .arg(lang)
        .output()
    {
        Ok(v) => v,
        Err(e) => return Err(e.to_string()),
    };

    if output.status.success() {
        let content = String::from_utf8(output.stdout).unwrap_or_default();
        Ok(content)
    } else {
        let content = String::from_utf8(output.stderr).unwrap_or_default();
        Err(content)
    }
}

#[tauri::command(async)]
#[cfg(target_os = "linux")]
pub fn system_ocr(app_handle: tauri::AppHandle, lang: &str) -> Result<String, String> {
    let mut app_cache_dir_path = cache_dir().expect("Get Cache Dir Failed");
    app_cache_dir_path.push(&app_handle.config().tauri.bundle.identifier);
    app_cache_dir_path.push("pot_screenshot_cut.png");
    let mut args = ["", ""];
    if lang != "auto" {
        args = ["-l", lang];
    }

    let output = match std::process::Command::new("tesseract")
        .arg(app_cache_dir_path.to_str().unwrap())
        .arg("stdout")
        .args(args)
        .output()
    {
        Ok(v) => v,
        Err(e) => {
            if e.to_string().contains("os error 2") {
                return Err("Tesseract not installed!".to_string());
            }
            return Err(e.to_string());
        }
    };
    if output.status.success() {
        let content = String::from_utf8(output.stdout).unwrap_or_default();
        Ok(content)
    } else {
        let content = String::from_utf8(output.stderr).unwrap_or_default();

        if content.contains("data") {
            if lang == "auto" {
                return Err(
                    "Language data not installed!\nPlease try install tesseract-ocr-eng"
                        .to_string(),
                );
            } else {
                return Err(format!(
                    "Language data not installed!\nPlease try install tesseract-ocr-{lang}"
                ));
            }
        }
        Err(content)
    }
}
