use once_cell::sync::Lazy;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Mutex,
    },
    time::Duration,
};
use tauri::Manager;

const LOCK: &str = include_str!("../rapidocr/runtime-lock.json");
const INSTALLER: &str = include_str!("../rapidocr/install.py");
const WORKER_SCRIPT: &str = include_str!("../rapidocr/worker.py");
static INSTALLING: AtomicBool = AtomicBool::new(false);
static WORKER: Lazy<Mutex<Option<Worker>>> = Lazy::new(|| Mutex::new(None));

fn manifest() -> Value {
    serde_json::from_str(LOCK).expect("bundled RapidOCR lock")
}
fn root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path_resolver()
        .app_local_data_dir()
        .map(|p| p.join("rapidocr").join(manifest()["id"].as_str().unwrap()))
        .ok_or_else(|| "无法定位本地数据目录。".into())
}
fn ready(path: &Path) -> bool {
    let marker: Option<Value> = fs::read(path.join("installed.json"))
        .ok()
        .and_then(|v| serde_json::from_slice(&v).ok());
    marker.as_ref().and_then(|v| v["id"].as_str()) == manifest()["id"].as_str()
        && path.join("runtime/python.exe").is_file()
}
fn prepare(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|_| "无法创建离线引擎目录。")?;
    for (name, content) in [
        ("runtime-lock.json", LOCK),
        ("install.py", INSTALLER),
        ("worker.py", WORKER_SCRIPT),
        (
            "NOTICE.zh-CN.md",
            include_str!("../rapidocr/NOTICE.zh-CN.md"),
        ),
    ] {
        fs::write(path.join(name), content).map_err(|_| "无法写入离线引擎组件。")?;
    }
    Ok(())
}
fn command(path: &Path, script: &str) -> Command {
    let mut command = Command::new(path.join("runtime/python.exe"));
    command
        .arg("-u")
        .arg(path.join(script))
        .arg(path)
        .current_dir(path)
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONUTF8", "1");
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command
}

#[tauri::command]
pub fn rapidocr_status(app: tauri::AppHandle) -> Result<Value, String> {
    let path = root(&app)?;
    Ok(
        json!({"ready": ready(&path), "installing": INSTALLING.load(Ordering::SeqCst), "version": "3.10.0", "path": path}),
    )
}

struct InstallingGuard;
impl Drop for InstallingGuard {
    fn drop(&mut self) {
        INSTALLING.store(false, Ordering::SeqCst);
    }
}

#[tauri::command]
pub async fn rapidocr_install(app: tauri::AppHandle) -> Result<Value, String> {
    if !cfg!(all(target_os = "windows", target_arch = "x86_64")) {
        return Err("离线引擎首版支持 Windows x64。".into());
    }
    if INSTALLING.swap(true, Ordering::SeqCst) {
        return Err("离线引擎正在安装，请稍候。".into());
    }
    let _guard = InstallingGuard;
    let path = root(&app)?;
    prepare(&path)?;
    // Stop the old private worker before repairing any runtime files.
    WORKER.lock().map_err(|_| "离线引擎状态异常。")?.take();
    if path.join("installed.json").exists() {
        fs::remove_file(path.join("installed.json")).map_err(|_| "无法更新离线引擎状态。")?;
    }
    let lock = manifest();
    let expected = lock["python"]["sha256"].as_str().unwrap();
    let archive_path = path.join("python.zip");
    let valid = fs::read(&archive_path)
        .map(|v| format!("{:x}", Sha256::digest(v)) == expected)
        .unwrap_or(false);
    if !valid {
        let _ = app.emit_all(
            "rapidocr-progress",
            json!({"detail": "下载独立 Python 运行环境", "percent": 0}),
        );
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(300))
            .build()
            .map_err(|_| "无法创建下载连接。")?;
        let bytes = client
            .get(lock["python"]["url"].as_str().unwrap())
            .send()
            .await
            .map_err(|_| "运行环境下载失败，请检查网络后重试。")?
            .error_for_status()
            .map_err(|_| "运行环境下载服务器返回错误。")?
            .bytes()
            .await
            .map_err(|_| "运行环境下载未完成。")?;
        if format!("{:x}", Sha256::digest(&bytes)) != expected {
            return Err("Python 运行环境 SHA256 校验失败。".into());
        }
        fs::write(&archive_path, bytes).map_err(|_| "无法保存运行环境，请检查磁盘空间。")?;
    }
    let app_copy = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let runtime = path.join("runtime");
        let file = fs::File::open(&archive_path).map_err(|_| "无法读取运行环境。")?;
        let mut archive = zip::ZipArchive::new(file).map_err(|_| "运行环境压缩包无效。")?;
        for i in 0..archive.len() {
            let mut entry = archive.by_index(i).map_err(|_| "无法解压运行环境。")?;
            let relative = entry.enclosed_name().ok_or("运行环境文件路径无效。")?;
            let destination = runtime.join(relative);
            if entry.is_dir() {
                fs::create_dir_all(&destination).map_err(|_| "无法创建运行目录。")?;
            } else {
                if let Some(parent) = destination.parent() {
                    fs::create_dir_all(parent).map_err(|_| "无法创建运行目录。")?;
                }
                let mut file = fs::File::create(destination).map_err(|_| "无法写入运行环境。")?;
                std::io::copy(&mut entry, &mut file).map_err(|_| "运行环境解压失败。")?;
            }
        }
        fs::write(
            runtime.join("python312._pth"),
            "python312.zip\n.\nLib/site-packages\nimport site\n",
        )
        .map_err(|_| "无法配置独立 Python。")?;
        let mut child = command(&path, "install.py")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|_| "无法启动离线引擎安装程序。")?;
        let stdout = child.stdout.take().unwrap();
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Ok(progress) = serde_json::from_str::<Value>(&line) {
                let _ = app_copy.emit_all("rapidocr-progress", progress);
            }
        }
        let status = child.wait().map_err(|_| "安装进程状态异常。")?;
        if !status.success() || !ready(&path) {
            return Err(
                "离线引擎安装失败，可重新下载并安装。详细信息见引擎目录中的 installation.log。"
                    .into(),
            );
        }
        Ok(json!({"ready": true, "version": "3.10.0"}))
    })
    .await
    .map_err(|_| "安装任务异常结束。".to_string())?
}

struct Worker {
    child: Child,
    stdin: ChildStdin,
    output: mpsc::Receiver<String>,
}
impl Drop for Worker {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
impl Worker {
    fn start(path: &Path) -> Result<Self, String> {
        prepare(path)?;
        let mut child = command(path, "worker.py")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|_| "无法启动本地 OCR进程。")?;
        let stdin = child.stdin.take().unwrap();
        let stdout = child.stdout.take().unwrap();
        let (tx, output) = mpsc::sync_channel(4);
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if tx.send(line).is_err() {
                    break;
                }
            }
        });
        let worker = Self {
            child,
            stdin,
            output,
        };
        let response = worker.receive()?;
        if response["ready"] != true {
            return Err("离线引擎加载失败，请在文字识别设置中修复安装。".into());
        }
        Ok(worker)
    }
    fn receive(&self) -> Result<Value, String> {
        let line = self
            .output
            .recv_timeout(Duration::from_secs(120))
            .map_err(|_| "本地 OCR超时或进程退出，请重试。")?;
        serde_json::from_str(&line).map_err(|_| "本地 OCR进程返回格式错误。".into())
    }
    fn recognize(&mut self, image: &str, threads: u8) -> Result<Value, String> {
        serde_json::to_writer(
            &mut self.stdin,
            &json!({"image": image, "threads": threads}),
        )
        .map_err(|_| "无法发送本地 OCR 请求。")?;
        self.stdin
            .write_all(b"\n")
            .and_then(|_| self.stdin.flush())
            .map_err(|_| "本地 OCR 进程已断开。")?;
        let response = self.receive()?;
        response
            .get("result")
            .filter(|v| v["text"].is_string() && v["lines"].is_array())
            .cloned()
            .ok_or_else(|| "RapidOCR 本地识别失败，请检查图片或在文字识别设置中修复安装。".into())
    }
}

#[tauri::command]
pub async fn rapidocr_recognize(
    app: tauri::AppHandle,
    image: String,
    threads: u8,
) -> Result<Value, String> {
    validate_request(&image, threads)?;
    if INSTALLING.load(Ordering::SeqCst) {
        return Err("离线引擎正在安装，请稍候。".into());
    }
    let path = root(&app)?;
    if !ready(&path) {
        return Err("请先在文字识别 → RapidOCR 中安装本地引擎。".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let mut state = WORKER.lock().map_err(|_| "离线引擎状态异常。")?;
        if INSTALLING.load(Ordering::SeqCst) {
            return Err("离线引擎正在安装，请稍候。".into());
        }
        if state.is_none() {
            *state = Some(Worker::start(&path)?);
        }
        let result = state.as_mut().unwrap().recognize(&image, threads);
        // Failed/timed-out responses cannot leak into the following request.
        if result.is_err() {
            state.take();
        }
        result
    })
    .await
    .map_err(|_| "本地 OCR任务异常结束。".to_string())?
}

fn validate_request(image: &str, threads: u8) -> Result<(), String> {
    if ![1, 2, 4, 8].contains(&threads) {
        return Err("无效的 CPU 线程数。".into());
    }
    if image.is_empty() || image.len() > 40_000_000 {
        return Err("图片数据无效或过大。".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_invalid_requests_before_starting_the_worker() {
        assert!(validate_request("", 2).is_err());
        assert!(validate_request("aQ==", 0).is_err());
        assert!(validate_request("aQ==", 128).is_err());
        assert!(validate_request("aQ==", 4).is_ok());
    }
    #[test]
    #[ignore = "requires the pinned RapidOCR runtime; set POT_RAPIDOCR_TEST_ROOT and POT_RAPIDOCR_TEST_IMAGE"]
    fn real_offline_worker_keeps_requests_in_sync() {
        use base64::Engine;
        let path = PathBuf::from(std::env::var("POT_RAPIDOCR_TEST_ROOT").unwrap());
        assert!(ready(&path));
        let image = base64::engine::general_purpose::STANDARD
            .encode(fs::read(std::env::var("POT_RAPIDOCR_TEST_IMAGE").unwrap()).unwrap());
        let mut worker = Worker::start(&path).unwrap();
        let result = worker.recognize(&image, 2).unwrap();
        assert!(!result["text"].as_str().unwrap().is_empty());
        assert!(!result["lines"].as_array().unwrap().is_empty());
        assert!(worker.recognize("invalid-image", 2).is_err());
        assert_eq!(worker.recognize(&image, 2).unwrap()["text"], result["text"]);
    }
}
