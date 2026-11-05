use crate::config::{get, set};
use crate::error::Error;
use crate::window::updater_window;
use log::warn;
use serde_json::Value;
use std::time::Duration;

#[tauri::command]
pub async fn latest_release() -> Result<Value, Error> {
    let response = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()?
        .get("https://api.github.com/repos/ShengjieLi-CN/Pot-Translate-Next/releases/latest")
        .header("User-Agent", "Pot-Translate-Next")
        .header("Accept", "application/vnd.github+json")
        .send()
        .await?;
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Err(Error::Error("仓库尚无公开的正式版本，请稍后再试。".into()));
    }
    Ok(response.error_for_status()?.json().await?)
}

fn version(value: &str) -> Option<Vec<u64>> {
    let parts: Vec<u64> = value
        .trim_start_matches('v')
        .split('.')
        .map(str::parse)
        .collect::<Result<_, _>>()
        .ok()?;
    (parts.len() == 3).then_some(parts)
}

pub fn check_update(app_handle: tauri::AppHandle) {
    let enable = get("check_update")
        .and_then(|v| v.as_bool())
        .unwrap_or_else(|| {
            set("check_update", true);
            true
        });
    if !enable {
        return;
    }
    let current = app_handle.package_info().version.to_string();
    tauri::async_runtime::spawn(async move {
        match latest_release().await {
            Ok(release) => {
                if !release["prerelease"].as_bool().unwrap_or(true)
                    && !release["draft"].as_bool().unwrap_or(true)
                {
                    if let (Some(latest), Some(current)) = (
                        release["tag_name"].as_str().and_then(version),
                        version(&current),
                    ) {
                        if latest > current {
                            updater_window();
                        }
                    }
                }
            }
            Err(e) => warn!("检查项目更新失败: {}", e),
        }
    });
}


// Only native code chooses release assets and the installer path.
use sha2::{Digest, Sha256};
use std::{path::PathBuf, sync::{Mutex, atomic::{AtomicBool, Ordering}}, io::{Read, Write}};
use tauri::Manager;

static DOWNLOADING: AtomicBool = AtomicBool::new(false);
static CANCEL_DOWNLOAD: AtomicBool = AtomicBool::new(false);
static INSTALLER: Mutex<Option<(PathBuf, String)>> = Mutex::new(None);
struct DownloadGuard;
impl Drop for DownloadGuard { fn drop(&mut self) { DOWNLOADING.store(false, Ordering::SeqCst); } }
struct PartialDownload(PathBuf);
impl Drop for PartialDownload { fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); } }

fn trusted_download(url: &str) -> bool {
    url.starts_with("https://github.com/ShengjieLi-CN/Pot-Translate-Next/releases/download/")
}
fn release_installer(release: &Value, current: &str) -> Result<(String, String, u64, String), String> {
    if release["draft"].as_bool().unwrap_or(true) || release["prerelease"].as_bool().unwrap_or(true) {
        return Err("没有可安装的正式版本。".into());
    }
    let tag = release["tag_name"].as_str().ok_or("版本号缺失。")?;
    if version(tag).zip(version(current)).is_none_or(|(a,b)| a <= b) {
        return Err("当前已是最新版本，无需安装。".into());
    }
    let name = format!("Pot.Translate.Next_{}_x64_zh-CN.msi", tag.trim_start_matches('v'));
    let assets = release["assets"].as_array().ok_or("此版本没有安装包。")?;
    let asset = assets.iter().find(|a| a["name"].as_str() == Some(&name)).ok_or("此版本未提供 x64 简体中文 MSI。")?;
    let url = asset["browser_download_url"].as_str().filter(|url| trusted_download(url)).ok_or("安装包下载地址不属于本项目。")?;
    let size = asset["size"].as_u64().filter(|n| *n > 0 && *n <= 1024*1024*1024).ok_or("安装包大小无效。")?;
    let digest = asset["digest"].as_str().and_then(|s| s.strip_prefix("sha256:"))
        .filter(|s| s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit()))
        .ok_or("发布版本缺少 SHA256 校验信息，请联系维护者。")?;
    Ok((name, url.into(), size, digest.to_lowercase()))
}
fn file_digest(path: &std::path::Path) -> Result<String, String> {
    let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new(); let mut buffer = [0u8; 65536];
    loop { let n = file.read(&mut buffer).map_err(|e| e.to_string())?; if n == 0 {break;} hasher.update(&buffer[..n]); }
    Ok(format!("{:x}", hasher.finalize()))
}
#[tauri::command]
pub fn cancel_update_download() { CANCEL_DOWNLOAD.store(true, Ordering::SeqCst); }

#[tauri::command]
pub async fn download_update(app: tauri::AppHandle) -> Result<(), String> {
    if !cfg!(all(target_os="windows", target_arch="x86_64")) { return Err("应用内更新目前仅支持 Windows x64。".into()); }
    if DOWNLOADING.swap(true, Ordering::SeqCst) { return Err("正在下载更新，请稍候。".into()); }
    let _guard = DownloadGuard;
    CANCEL_DOWNLOAD.store(false, Ordering::SeqCst);
    let release = latest_release().await.map_err(|e| e.to_string())?;
    let (name, url, size, digest) = release_installer(&release, &app.package_info().version.to_string())?;
    let directory = app.path_resolver().app_cache_dir().ok_or("无法访问更新缓存目录。")?.join("updates").join(uuid::Uuid::new_v4().to_string());
    std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let cleanup = PartialDownload(directory.clone());
    let part = directory.join("download.part");
    let ready = directory.join(name);
    let client = reqwest::Client::builder().connect_timeout(Duration::from_secs(20)).timeout(Duration::from_secs(600))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            let url = attempt.url(); let host = url.host_str().unwrap_or("");
            if attempt.previous().len() >= 8 { return attempt.error("下载重定向次数过多"); }
            if url.scheme() == "https" && (host == "github.com" || host.ends_with(".githubusercontent.com") || host.ends_with(".github.com")) { attempt.follow() }
            else { attempt.error("不受信任的下载重定向") }
        })).build().map_err(|e| e.to_string())?;
    let mut response = client.get(url).header("User-Agent", "Pot-Translate-Next").send().await.map_err(|e| format!("下载失败：{e}"))?.error_for_status().map_err(|e| e.to_string())?;
    let mut file = std::fs::File::create(&part).map_err(|e| e.to_string())?;
    let mut downloaded = 0u64; let mut hash = Sha256::new();
    let mut last_progress = std::time::Instant::now();
    while let Some(chunk) = response.chunk().await.map_err(|e| format!("下载中断：{e}"))? {
        if CANCEL_DOWNLOAD.load(Ordering::SeqCst) {return Err("已取消下载。".into());}
        downloaded += chunk.len() as u64;
        if downloaded > size {return Err("安装包大小与发布信息不一致。".into());}
        file.write_all(&chunk).map_err(|e| e.to_string())?; hash.update(&chunk);
        if last_progress.elapsed() >= Duration::from_millis(120) {
            let _ = app.emit_all("update-download-progress", serde_json::json!({"downloaded":downloaded,"total":size}));
            last_progress = std::time::Instant::now();
        }
    }
    file.sync_all().map_err(|e| e.to_string())?; drop(file);
    if CANCEL_DOWNLOAD.load(Ordering::SeqCst) {return Err("已取消下载。".into());}
    if downloaded != size || format!("{:x}", hash.finalize()) != digest {return Err("安装包校验失败，请重新下载。".into());}
    std::fs::rename(&part, &ready).map_err(|e| e.to_string())?;
    let old = INSTALLER.lock().unwrap().replace((ready, digest));
    if let Some((path, _)) = old {if let Some(dir) = path.parent() {let _ = std::fs::remove_dir_all(dir);}}
    std::mem::forget(cleanup);
    let _ = app.emit_all("update-download-progress", serde_json::json!({"downloaded":size,"total":size}));
    Ok(())
}

#[tauri::command]
pub async fn install_update(app: tauri::AppHandle) -> Result<(), String> {
    if DOWNLOADING.load(Ordering::SeqCst) {return Err("请等待下载完成。".into());}
    let (path, digest) = INSTALLER.lock().unwrap().clone().ok_or("请先下载更新。")?;
    if file_digest(&path)? != digest {return Err("安装包已变化，校验失败，请重新下载。".into());}
    #[cfg(target_os="windows")]
    {
        use std::os::windows::process::CommandExt;
        // Wait for UAC approval before exiting. A cancelled prompt leaves the app running.
        let escaped = path.to_string_lossy().replace("'", "''");
        let command = format!("$ErrorActionPreference='Stop'; Start-Process -FilePath \"$env:SystemRoot/System32/msiexec.exe\" -Verb RunAs -ArgumentList '/i \"{escaped}\" /passive /norestart' | Out-Null");
        let result = tauri::async_runtime::spawn_blocking(move || {
            std::process::Command::new("powershell.exe").args(["-NoProfile", "-NonInteractive", "-Command", &command])
                .creation_flags(0x08000000).output()
        }).await.map_err(|e| e.to_string())?.map_err(|e| e.to_string())?;
        if !result.status.success() {return Err("未能启动安装程序，可能已取消管理员授权。可再次点击安装。".into());}
        app.exit(0);
        Ok(())
    }
    #[cfg(not(target_os="windows"))]
    { let _ = app; Err("仅支持 Windows 安装包。".into()) }
}

#[cfg(test)]
mod update_tests {
    use super::*;
    fn release() -> Value {serde_json::json!({"tag_name":"v3.2.9","draft":false,"prerelease":false,"assets":[{"name":"Pot.Translate.Next_3.2.9_x64_zh-CN.msi","size":100,"digest":format!("sha256:{}", "a".repeat(64)),"browser_download_url":"https://github.com/ShengjieLi-CN/Pot-Translate-Next/releases/download/v3.2.9/Pot.Translate.Next_3.2.9_x64_zh-CN.msi"}]})}
    #[test] fn validates_release_and_rejects_downgrades() {
        assert!(release_installer(&release(), "3.2.7").is_ok());
        assert!(release_installer(&release(), "3.2.9").is_err());
        assert!(release_installer(&release(), "3.3.0").is_err());
        for key in ["draft", "prerelease"] {let mut r=release();r[key]=true.into();assert!(release_installer(&r,"3.2.7").is_err());}
    }
    #[test] fn rejects_untrusted_or_unverifiable_assets() {
        for (field,value) in [("browser_download_url", "https://example.com/a.msi"), ("digest","sha256:bad"), ("name","Pot.Translate.Next_3.2.9_x64_en-US.msi")] {
            let mut r=release();r["assets"][0][field]=value.into();assert!(release_installer(&r,"3.2.7").is_err());
        }
    }
    #[test] fn hashes_actual_file_contents() {
        let p=std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());std::fs::write(&p,b"abc").unwrap();
        assert_eq!(file_digest(&p).unwrap(), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");std::fs::remove_file(p).unwrap();
    }
}
