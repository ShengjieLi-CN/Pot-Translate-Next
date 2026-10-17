use base64::{engine::general_purpose::STANDARD, Engine};
use once_cell::sync::Lazy;
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::Duration;

struct CaptureControl {
    session: String,
    owner: String,
    stop: Arc<AtomicBool>,
}
static CAPTURE: Lazy<Mutex<Option<CaptureControl>>> = Lazy::new(|| Mutex::new(None));

pub fn stop_for_window(label: &str) {
    if let Ok(control) = CAPTURE.lock() {
        if let Some(c) = control.as_ref().filter(|c| c.owner == label) {
            c.stop.store(true, Ordering::SeqCst);
        }
    }
}

#[tauri::command]
pub fn live_audio_stop(window: tauri::Window, session: String) -> Result<(), String> {
    let control = CAPTURE.lock().map_err(|_| "Audio state unavailable")?;
    if let Some(c) = control
        .as_ref()
        .filter(|c| c.session == session && c.owner == window.label())
    {
        c.stop.store(true, Ordering::SeqCst);
    }
    Ok(())
}

#[tauri::command(async)]
pub fn live_audio_start(
    window: tauri::Window,
    session: String,
    source: String,
) -> Result<(), String> {
    if !["microphone", "system"].contains(&source.as_str()) {
        return Err("Invalid audio source".into());
    }
    let stop = Arc::new(AtomicBool::new(false));
    {
        let mut control = CAPTURE.lock().map_err(|_| "Audio state unavailable")?;
        if control.is_some() {
            return Err("已有音频录制正在运行，请先停止。".into());
        }
        *control = Some(CaptureControl {
            session: session.clone(),
            owner: window.label().into(),
            stop: stop.clone(),
        });
    }
    let (ready_tx, ready_rx) = std::sync::mpsc::sync_channel(1);
    std::thread::spawn(move || {
        let result = capture_audio(&window, &session, &source, stop, ready_tx);
        if let Err(error) = result {
            let _ = window.emit(
                "live-audio-error",
                json!({"session": session, "error": error}),
            );
        }
        if let Ok(mut control) = CAPTURE.lock() {
            if control.as_ref().map(|c| &c.session) == Some(&session) {
                *control = None;
            }
        }
        let _ = window.emit("live-audio-stopped", json!({"session": session}));
    });
    ready_rx
        .recv_timeout(Duration::from_secs(10))
        .map_err(|_| "Audio device did not initialize".to_string())?
}

#[cfg(not(target_os = "windows"))]
fn capture_audio(
    _: &tauri::Window,
    _: &str,
    _: &str,
    _: Arc<AtomicBool>,
    ready: std::sync::mpsc::SyncSender<Result<(), String>>,
) -> Result<(), String> {
    let error = "当前原生实时音频采集仅支持 Windows。".to_string();
    let _ = ready.send(Err(error.clone()));
    Err(error)
}

#[cfg(target_os = "windows")]
fn capture_audio(
    window: &tauri::Window,
    session: &str,
    source: &str,
    stop: Arc<AtomicBool>,
    ready: std::sync::mpsc::SyncSender<Result<(), String>>,
) -> Result<(), String> {
    capture_windows(source, stop, ready, |pcm, peak, sequence| {
        window
            .emit(
                "live-audio-frame",
                json!({"session": session, "sampleRate": 16000,
            "pcm": STANDARD.encode(pcm), "peak": peak, "sequence": sequence}),
            )
            .map_err(|e| e.to_string())
    })
}

#[cfg(target_os = "windows")]
fn capture_windows(
    source: &str,
    stop: Arc<AtomicBool>,
    ready: std::sync::mpsc::SyncSender<Result<(), String>>,
    mut on_packet: impl FnMut(Vec<u8>, f32, u64) -> Result<(), String>,
) -> Result<(), String> {
    use windows::Win32::{Media::Audio::*, System::Com::*};
    struct ComGuard;
    impl Drop for ComGuard {
        fn drop(&mut self) {
            unsafe {
                CoUninitialize();
            }
        }
    }
    struct AudioGuard(IAudioClient);
    impl Drop for AudioGuard {
        fn drop(&mut self) {
            unsafe {
                let _ = self.0.Stop();
            }
        }
    }
    unsafe {
        let init = (|| -> windows::core::Result<(ComGuard, AudioGuard, IAudioCaptureClient, u32, u16, u16, bool)> {
            CoInitializeEx(None, COINIT_MULTITHREADED).ok()?;
            let com = ComGuard;
            let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
            let device = enumerator.GetDefaultAudioEndpoint(if source == "system" { eRender } else { eCapture }, eMultimedia)?;
            let client: IAudioClient = device.Activate(CLSCTX_ALL, None)?;
            let format = client.GetMixFormat()?;
            let copied = format.read_unaligned();
            let float = if copied.wFormatTag == 0xfffe && copied.cbSize >= 22 {
                (*format.cast::<WAVEFORMATEXTENSIBLE>()).SubFormat.data1 == 3
            } else { copied.wFormatTag == 3 };
            let result = client.Initialize(AUDCLNT_SHAREMODE_SHARED,
                if source == "system" { AUDCLNT_STREAMFLAGS_LOOPBACK } else { 0 }, 1_000_000, 0, format, None);
            CoTaskMemFree(Some(format.cast())); result?;
            let capture: IAudioCaptureClient = client.GetService()?;
            client.Start()?;
            Ok((com, AudioGuard(client), capture, copied.nSamplesPerSec, copied.nChannels, copied.wBitsPerSample, float))
        })();
        let (_com, _client, capture, sample_rate, channels, bits, float) = match init {
            Ok(v) => v,
            Err(e) => {
                let error = format!("无法打开音频设备：{e}");
                let _ = ready.send(Err(error.clone()));
                return Err(error);
            }
        };
        if channels == 0 || ![16, 24, 32].contains(&bits) || (float && bits != 32) {
            let error = "不支持当前音频设备的采样格式。".to_string();
            let _ = ready.send(Err(error.clone()));
            return Err(error);
        }
        let _ = ready.send(Ok(()));
        let mut packet = Vec::new();
        let mut peak = 0.0f32;
        let mut input_index = 0u64;
        let mut next_output = 0.0f64;
        let mut previous = 0.0f32;
        let step = sample_rate as f64 / 16000.0;
        let mut last_emit = std::time::Instant::now();
        let mut sequence = 0u64;
        let mut emit = |pcm: &mut Vec<u8>, peak: f32, sequence: u64| -> Result<(), String> {
            if pcm.is_empty() {
                return Ok(());
            }
            on_packet(std::mem::take(pcm), peak, sequence)
        };
        while !stop.load(Ordering::SeqCst) {
            let mut count = capture.GetNextPacketSize().map_err(|e| e.to_string())?;
            while count > 0 {
                let mut data = std::ptr::null_mut();
                let mut frames = 0u32;
                let mut flags = 0u32;
                capture
                    .GetBuffer(&mut data, &mut frames, &mut flags, None, None)
                    .map_err(|e| e.to_string())?;
                let silent = flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 != 0;
                let stride = bits as usize / 8;
                for frame in 0..frames as usize {
                    let mut mono = 0.0;
                    if !silent && !data.is_null() {
                        for channel in 0..channels as usize {
                            let p = data.add((frame * channels as usize + channel) * stride);
                            mono += if float {
                                p.cast::<f32>().read_unaligned()
                            } else if bits == 16 {
                                p.cast::<i16>().read_unaligned() as f32 / 32768.0
                            } else if bits == 24 {
                                i32::from_le_bytes([0, *p, *p.add(1), *p.add(2)]) as f32
                                    / 2147483648.0
                            } else {
                                p.cast::<i32>().read_unaligned() as f32 / 2147483648.0
                            };
                        }
                        mono /= channels as f32;
                    }
                    if !mono.is_finite() {
                        mono = 0.0;
                    }
                    peak = peak.max(mono.abs());
                    while next_output <= input_index as f64 {
                        let fraction =
                            (next_output - (input_index as f64 - 1.0)).clamp(0.0, 1.0) as f32;
                        let sample = if input_index == 0 {
                            mono
                        } else {
                            previous + (mono - previous) * fraction
                        };
                        packet.extend_from_slice(
                            &((sample.clamp(-1.0, 1.0) * 32767.0) as i16).to_le_bytes(),
                        );
                        next_output += step;
                    }
                    previous = mono;
                    input_index += 1;
                }
                capture.ReleaseBuffer(frames).map_err(|e| e.to_string())?;
                count = capture.GetNextPacketSize().map_err(|e| e.to_string())?;
            }
            if last_emit.elapsed() >= Duration::from_millis(100) {
                // Some loopback drivers stop delivering packets when no app
                // renders sound. Keep silence in the recording's time axis.
                if packet.is_empty() {
                    packet.resize(
                        (last_emit.elapsed().as_secs_f64() * 16000.0).round() as usize * 2,
                        0,
                    );
                }
                emit(&mut packet, peak, sequence)?;
                sequence += 1;
                peak = 0.0;
                last_emit = std::time::Instant::now();
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        emit(&mut packet, peak, sequence)?;
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SttConfig {
    endpoint: String,
    api_key: String,
    model: String,
    response_format: String,
    extra: String,
}
#[derive(Deserialize)]
pub struct SpeakerReference {
    name: String,
    audio: String,
}

#[tauri::command]
pub async fn live_transcribe(
    config: SttConfig,
    audio: String,
    language: String,
    references: Vec<SpeakerReference>,
) -> Result<Value, String> {
    use reqwest::multipart::{Form, Part};
    let url = reqwest::Url::parse(&config.endpoint).map_err(|_| "STT 接口地址无效")?;
    if !["http", "https"].contains(&url.scheme())
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("STT 地址必须使用 HTTP/HTTPS，且不能包含登录凭据。".into());
    }
    if config.model.trim().is_empty() {
        return Err("请填写 STT 模型。".into());
    }
    if audio.len() > 34_000_000 {
        return Err("音频分段超过 25MB。".into());
    }
    let bytes = STANDARD.decode(audio).map_err(|_| "音频编码无效")?;
    if bytes.len() < 44 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err("STT 音频必须是 WAV。".into());
    }
    let extra: Value =
        serde_json::from_str(&config.extra).map_err(|_| "STT 附加参数不是有效 JSON")?;
    let extra = extra.as_object().ok_or("STT 附加参数必须是对象")?;
    let reserved = [
        "file",
        "model",
        "stream",
        "response_format",
        "language",
        "known_speaker_names",
        "known_speaker_references",
    ];
    if extra.keys().any(|k| reserved.contains(&k.as_str())) {
        return Err("STT 附加参数不能覆盖核心字段。".into());
    }
    let mut form = Form::new()
        .part(
            "file",
            Part::bytes(bytes)
                .file_name("live.wav")
                .mime_str("audio/wav")
                .map_err(|_| "Invalid WAV MIME")?,
        )
        .text("model", config.model)
        .text("response_format", config.response_format)
        .text("stream", "false");
    if language != "auto" {
        form = form.text("language", language);
    }
    for (key, value) in extra {
        if let Some(items) = value.as_array() {
            for item in items {
                form = form.text(
                    format!("{key}[]"),
                    item.as_str()
                        .map(str::to_owned)
                        .unwrap_or_else(|| item.to_string()),
                );
            }
        } else {
            form = form.text(
                key.clone(),
                value
                    .as_str()
                    .map(str::to_owned)
                    .unwrap_or_else(|| value.to_string()),
            );
        }
    }
    for reference in references.into_iter().take(4) {
        if !reference.audio.starts_with("data:audio/wav;base64,")
            || reference.audio.len() > 6_000_000
        {
            return Err("说话人参考音频无效。".into());
        }
        form = form
            .text("known_speaker_names[]", reference.name)
            .text("known_speaker_references[]", reference.audio);
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "无法创建 STT 请求")?;
    let mut request = client.post(url).multipart(form);
    if !config.api_key.is_empty() {
        request = request.bearer_auth(config.api_key);
    }
    // Never log audio, tokens, or URLs containing credentials.
    let response = request.send().await.map_err(|e| {
        if e.is_timeout() {
            "STT 请求超时。".to_string()
        } else {
            "无法连接 STT 服务，请检查接口地址和网络。".to_string()
        }
    })?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!(
            "STT 请求失败（HTTP {}），请检查模型、参数与访问凭据。",
            status.as_u16()
        ));
    }
    if response.content_length().unwrap_or(0) > 8_000_000 {
        return Err("STT 返回数据过大。".into());
    }
    let body = response.text().await.map_err(|_| "无法读取 STT 响应")?;
    if body.len() > 8_000_000 {
        return Err("STT 返回数据过大。".into());
    }
    serde_json::from_str(&body).map_err(|_| "STT 服务未返回有效 JSON，请检查返回格式。".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compatible_stt_posts_wav_model_parameters_and_references() {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut bytes = Vec::new();
            let mut buffer = [0u8; 8192];
            loop {
                let count = stream.read(&mut buffer).unwrap();
                if count == 0 {
                    break;
                }
                bytes.extend_from_slice(&buffer[..count]);
                if let Some(index) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                    let headers = String::from_utf8_lossy(&bytes[..index]).to_lowercase();
                    let length: usize = headers
                        .lines()
                        .find_map(|l| l.strip_prefix("content-length:"))
                        .unwrap()
                        .trim()
                        .parse()
                        .unwrap();
                    if bytes.len() >= index + 4 + length {
                        break;
                    }
                }
            }
            let request = String::from_utf8_lossy(&bytes);
            assert!(request.contains("name=\"model\"\r\n\r\ncustom-stt"));
            assert!(request.contains("name=\"file\"; filename=\"live.wav\""));
            assert!(request.contains("name=\"known_speaker_names[]\"\r\n\r\nspeaker_1"));
            assert!(request.contains("name=\"diarize\"\r\n\r\ntrue"));
            let body = r#"{"segments":[{"start":0,"end":1,"text":"Hello","speaker":"A"}]}"#;
            write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body).unwrap();
        });
        let mut audio = vec![0; 46];
        audio[..4].copy_from_slice(b"RIFF");
        audio[8..12].copy_from_slice(b"WAVE");
        let result = tauri::async_runtime::block_on(live_transcribe(
            SttConfig {
                endpoint: format!("http://{address}/v1/audio/transcriptions"),
                api_key: String::new(),
                model: "custom-stt".into(),
                response_format: "diarized_json".into(),
                extra: r#"{"diarize":true}"#.into(),
            },
            STANDARD.encode(audio),
            "en".into(),
            vec![SpeakerReference {
                name: "speaker_1".into(),
                audio: "data:audio/wav;base64,UklGRg==".into(),
            }],
        ))
        .unwrap();
        assert_eq!(result["segments"][0]["speaker"], "A");
        server.join().unwrap();
    }

    #[test]
    #[cfg(target_os = "windows")]
    #[ignore = "requires a real Windows audio output device; run explicitly"]
    fn windows_loopback_opens_captures_pcm_and_stops() {
        use std::sync::atomic::AtomicUsize;
        let stop = Arc::new(AtomicBool::new(false));
        let stop_copy = stop.clone();
        let frames = Arc::new(AtomicUsize::new(0));
        let frames_copy = frames.clone();
        let (tx, rx) = std::sync::mpsc::sync_channel(1);
        let thread = std::thread::spawn(move || {
            capture_windows("system", stop_copy, tx, move |bytes, _, _| {
                assert_eq!(bytes.len() % 2, 0);
                frames_copy.fetch_add(bytes.len() / 2, Ordering::SeqCst);
                Ok(())
            })
        });
        rx.recv_timeout(Duration::from_secs(5)).unwrap().unwrap();
        std::thread::sleep(Duration::from_millis(450));
        stop.store(true, Ordering::SeqCst);
        thread.join().unwrap().unwrap();
        assert!(frames.load(Ordering::SeqCst) >= 1600);
    }
}
