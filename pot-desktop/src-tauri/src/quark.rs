//! Quark backups through a user-configured OpenList service.
use crate::error::Error;
use reqwest::{Client, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use uuid::Uuid;

static BUSY: AtomicBool = AtomicBool::new(false);
fn error(message: impl Into<String>) -> Error {
    Error::Error(message.into().into())
}
fn network(_: reqwest::Error) -> Error {
    error("OpenList 请求失败，请检查服务地址和网络连接。")
}
fn required(value: &Value, key: &str) -> Result<String, Error> {
    value[key]
        .as_str()
        .filter(|v| !v.trim().is_empty())
        .map(str::to_owned)
        .ok_or_else(|| error(format!("请填写有效的 {key}。")))
}
fn service_url(value: &str) -> Result<String, Error> {
    let url = Url::parse(value.trim()).map_err(|_| error("OpenList 服务地址无效。"))?;
    let loopback = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    if url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || (url.scheme() != "https" && !(url.scheme() == "http" && loopback))
    {
        return Err(error(
            "OpenList 地址须使用 HTTPS，本机服务可使用 HTTP；地址中不能包含账号、查询参数或锚点。",
        ));
    }
    Ok(url.to_string().trim_end_matches('/').to_string())
}
fn directory(value: &str) -> Result<String, Error> {
    let path = value.trim().trim_end_matches('/');
    if !path.starts_with('/')
        || path.len() < 2
        || path.len() > 1024
        || path.contains('\\')
        || path.chars().any(char::is_control)
        || path[1..]
            .split('/')
            .any(|v| v.is_empty() || v == "." || v == "..")
    {
        return Err(error(
            "请填写 OpenList 中已存在的完整备份目录，例如 /夸克/Pot Translate Next。",
        ));
    }
    Ok(path.to_string())
}
fn filename(value: &str) -> Result<(), Error> {
    if value.is_empty()
        || value.len() > 255
        || !value.to_ascii_lowercase().ends_with(".zip")
        || value.contains(['/', '\\'])
        || value.chars().any(char::is_control)
    {
        return Err(error("请选择有效的 ZIP 备份文件。"));
    }
    Ok(())
}
fn save_json(path: &Path, value: &impl Serialize) -> Result<(), Error> {
    let temp = path.with_extension(format!("{}.tmp", Uuid::new_v4()));
    std::fs::write(&temp, serde_json::to_vec_pretty(value)?)?;
    if let Err(e) = std::fs::rename(&temp, path) {
        let _ = std::fs::remove_file(temp);
        return Err(e.into());
    }
    Ok(())
}

#[derive(Default, Clone, Serialize, Deserialize)]
#[serde(default)]
struct Settings {
    url: String,
    token: String,
    directory: String,
}
struct Drive {
    root: PathBuf,
    client: Client,
}
impl Drive {
    fn new(root: PathBuf) -> Result<Self, Error> {
        Ok(Self {
            root,
            client: Client::builder()
                .timeout(Duration::from_secs(300))
                .redirect(reqwest::redirect::Policy::none())
                .user_agent("Pot-Translate-Next")
                .build()
                .map_err(network)?,
        })
    }
    fn settings(&self) -> Result<Settings, Error> {
        let path = self.root.join("quark-openlist.json");
        if !path.exists() {
            return Ok(Settings {
                directory: "/夸克/Pot Translate Next".into(),
                ..Settings::default()
            });
        }
        Ok(serde_json::from_slice(&std::fs::read(path)?)?)
    }
    fn state(&self) -> Result<Value, Error> {
        let settings = self.settings()?;
        Ok(
            json!({ "url": settings.url, "directory": settings.directory, "has_token": !settings.token.is_empty() }),
        )
    }
    fn configure(&self, options: &Value) -> Result<Value, Error> {
        let old = self.settings()?;
        let url = service_url(&required(options, "url")?)?;
        let directory = directory(&required(options, "directory")?)?;
        let supplied = options["token"].as_str().unwrap_or_default().trim();
        let token = if supplied.is_empty() {
            if old.url != url || old.token.is_empty() {
                return Err(error(
                    "请填写 OpenList 服务令牌；更换服务地址时需重新填写令牌。",
                ));
            }
            old.token
        } else {
            supplied.to_string()
        };
        if token.chars().any(char::is_control) {
            return Err(error("OpenList 服务令牌格式无效。"));
        }
        save_json(
            &self.root.join("quark-openlist.json"),
            &Settings {
                url,
                token,
                directory,
            },
        )?;
        self.state()
    }
    fn configured(&self) -> Result<Settings, Error> {
        let settings = self.settings()?;
        service_url(&settings.url)?;
        directory(&settings.directory)?;
        if settings.token.is_empty() {
            return Err(error("请先保存 OpenList 服务地址、令牌和备份目录。"));
        }
        Ok(settings)
    }
    async fn result(&self, response: reqwest::Response) -> Result<Value, Error> {
        let status = response.status();
        if !status.is_success() {
            return Err(error(format!(
                "OpenList 请求失败（HTTP {}），请检查令牌与服务配置。",
                status.as_u16()
            )));
        }
        let value: Value = response
            .json()
            .await
            .map_err(|_| error("OpenList 返回的数据格式无效，请检查服务地址。"))?;
        if value["code"].as_u64() != Some(200) {
            return Err(error(format!(
                "OpenList 操作失败（code {}），请检查令牌、目录及读写权限。",
                value["code"].as_i64().unwrap_or(-1)
            )));
        }
        Ok(value["data"].clone())
    }
    async fn api(&self, endpoint: &str, body: Value) -> Result<Value, Error> {
        let settings = self.configured()?;
        let response = self
            .client
            .post(format!("{}/api/fs/{endpoint}", settings.url))
            .header("Authorization", &settings.token)
            .json(&body)
            .send()
            .await
            .map_err(network)?;
        self.result(response).await
    }
    async fn list(&self) -> Result<Value, Error> {
        let settings = self.configured()?;
        let mut files = Vec::new();
        let mut seen = HashSet::new();
        for page in 1..=1000 {
            let data = self.api("list", json!({ "path": settings.directory, "password": "", "page": page, "per_page": 100, "refresh": true })).await?;
            let total = data["total"]
                .as_u64()
                .ok_or_else(|| error("OpenList 文件列表格式无效。"))?;
            let content = match data.get("content") {
                Some(Value::Array(items)) => items.as_slice(),
                Some(Value::Null) if total == 0 => &[],
                _ => return Err(error("OpenList 文件列表格式无效。")),
            };
            let mut progress = false;
            for item in content {
                let name = item["name"]
                    .as_str()
                    .ok_or_else(|| error("OpenList 文件名格式无效。"))?;
                progress |= seen.insert(name.to_string());
                if item["is_dir"].as_bool() == Some(false) && filename(name).is_ok() {
                    files.push(
                        json!({ "name": name, "size": item["size"], "modified": item["modified"] }),
                    );
                }
            }
            if page * 100 >= total {
                files.sort_by(|a, b| b["name"].as_str().cmp(&a["name"].as_str()));
                files.dedup_by(|a, b| a["name"] == b["name"]);
                return Ok(json!(files));
            }
            if content.is_empty() || !progress {
                return Err(error("OpenList 文件分页不完整，请刷新后重试。"));
            }
        }
        Err(error("备份数量过多，请在 OpenList 中整理后重试。"))
    }
    async fn upload(&self, path: &Path, name: &str) -> Result<(), Error> {
        filename(name)?;
        let settings = self.configured()?;
        // File-Path is a percent-encoded HTTP header, not a URL query string.
        let remote = format!("{}/{name}", settings.directory);
        let encoded: String = remote
            .as_bytes()
            .iter()
            .map(|b| {
                if b.is_ascii_alphanumeric() || b"-_.~".contains(b) {
                    (*b as char).to_string()
                } else {
                    format!("%{b:02X}")
                }
            })
            .collect();
        let bytes = std::fs::read(path)?;
        let response = self
            .client
            .put(format!("{}/api/fs/put", settings.url))
            .header("Authorization", &settings.token)
            .header("File-Path", encoded)
            .header("As-Task", "false")
            .header("Overwrite", "false")
            .header("Content-Type", "application/zip")
            .body(bytes)
            .send()
            .await
            .map_err(network)?;
        let data = self.result(response).await?;
        if data.get("task").filter(|v| !v.is_null()).is_some() {
            return Err(error("OpenList 尚未确认上传完成，请在服务中检查任务状态。"));
        }
        Ok(())
    }
    async fn download(&self, name: &str) -> Result<Vec<u8>, Error> {
        filename(name)?;
        let settings = self.configured()?;
        let info = self
            .api(
                "get",
                json!({ "path": format!("{}/{name}", settings.directory), "password": "" }),
            )
            .await?;
        if info["is_dir"].as_bool() == Some(true) {
            return Err(error("请选择 ZIP 备份文件。"));
        }
        let raw = required(&info, "raw_url")?;
        let base = Url::parse(&format!("{}/", settings.url))
            .map_err(|_| error("OpenList 服务地址无效。"))?;
        let mut url = base
            .join(&raw)
            .map_err(|_| error("OpenList 下载地址无效。"))?;
        for _ in 0..6 {
            // Apply the same transport restrictions to signed links and redirects.
            let mut transport = url.clone();
            transport.set_query(None);
            transport.set_fragment(None);
            service_url(transport.as_str())?;
            if url.fragment().is_some() {
                return Err(error("OpenList 下载地址无效。"));
            }
            let mut request = self.client.get(url.clone());
            if url.origin() == base.origin()
                && (base.path() == "/" || url.path().starts_with(base.path()))
            {
                request = request.header("Authorization", &settings.token);
            }
            let response = request.send().await.map_err(network)?;
            if response.status().is_redirection() {
                let next = response
                    .headers()
                    .get("Location")
                    .and_then(|v| v.to_str().ok())
                    .ok_or_else(|| error("OpenList 下载重定向无效。"))?;
                url = url
                    .join(next)
                    .map_err(|_| error("OpenList 下载重定向无效。"))?;
                continue;
            }
            if !response.status().is_success() {
                return Err(error(format!(
                    "OpenList 下载失败（HTTP {}），请检查夸克存储和代理配置。",
                    response.status().as_u16()
                )));
            }
            let data = response.bytes().await.map_err(network)?.to_vec();
            if info["size"]
                .as_u64()
                .map_or(false, |size| size != data.len() as u64)
            {
                return Err(error("下载的备份不完整，请重新尝试。"));
            }
            return Ok(data);
        }
        Err(error("OpenList 下载重定向次数过多。"))
    }
    async fn remove(&self, name: &str) -> Result<(), Error> {
        filename(name)?;
        let settings = self.configured()?;
        self.api(
            "remove",
            json!({ "dir": settings.directory, "names": [name] }),
        )
        .await?;
        Ok(())
    }
}

struct Guard;
impl Drop for Guard {
    fn drop(&mut self) {
        BUSY.store(false, Ordering::Release);
    }
}
#[tauri::command]
pub async fn quark_drive(operate: String, options: Option<Value>) -> Result<Value, Error> {
    let root = crate::backup::backup_config_dir()?;
    let drive = Drive::new(root.clone())?;
    if BUSY
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err(error("OpenList 正在处理其他操作，请稍后重试。"));
    }
    let _guard = Guard;
    let options = options.unwrap_or_else(|| json!({}));
    // Reuse settings from the earlier OpenList version when available. Direct Quark credentials are never used.
    if !root.join("quark-openlist.json").exists() {
        let values: Vec<_> = ["quark_service_url", "quark_token", "quark_backup_path"]
            .iter()
            .map(|key| crate::config::get(key))
            .collect();
        if let [Some(url), Some(token), Some(directory)] = values.as_slice() {
            let _ = drive.configure(&json!({ "url": url, "token": token, "directory": directory }));
        }
    }
    match operate.as_str() {
        "status" => drive.state(),
        "configure" => drive.configure(&options),
        "test" => {
            let files = drive.list().await?;
            Ok(json!({ "count": files.as_array().map_or(0, Vec::len) }))
        }
        "list" => drive.list().await,
        "backup" => {
            let timestamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis();
            let name = format!(
                "PotTranslateNext-{timestamp}-{}.zip",
                &Uuid::new_v4().to_string()[..8]
            );
            let path = root.join(&name);
            let outcome = async {
                crate::backup::local("put", path.to_string_lossy().to_string()).await?;
                drive.upload(&path, &name).await?;
                Ok(json!({ "name": name }))
            }
            .await;
            let _ = std::fs::remove_file(path);
            outcome
        }
        "restore" => {
            let name = required(&options, "name")?;
            let data = drive.download(&name).await?;
            let mut archive = zip::ZipArchive::new(std::io::Cursor::new(data))?;
            crate::backup::restore_archive(&mut archive, &root)?;
            Ok(json!({}))
        }
        "remove" => {
            let name = required(&options, "name")?;
            drive.remove(&name).await?;
            Ok(json!({}))
        }
        _ => Err(error("不支持的 OpenList 操作。")),
    }
}

#[cfg(test)]
#[path = "quark_tests.rs"]
mod tests;
