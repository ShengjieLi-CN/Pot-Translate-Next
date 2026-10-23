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
