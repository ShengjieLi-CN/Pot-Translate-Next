use crate::error::Error;
use log::info;
use reqwest_dav::{Auth, ClientBuilder, Depth};
use std::io::Write;
use std::path::PathBuf;
use walkdir::WalkDir;
use zip::read::ZipArchive;
use zip::write::SimpleFileOptions;

#[tauri::command(async)]
pub async fn webdav(
    operate: &str,
    url: String,
    username: String,
    password: String,
    name: Option<String>,
) -> Result<String, Error> {
    // build a client
    let client = ClientBuilder::new()
        .set_host(url.clone())
        .set_auth(Auth::Basic(username.clone(), password.clone()))
        .build()?;
    client.mkcol("/pot-app").await.unwrap_or_default();
    let client = ClientBuilder::new()
        .set_host(format!("{}/pot-app", url.trim_end_matches("/")))
        .set_auth(Auth::Basic(username, password))
        .build()?;
    match operate {
        "list" => {
            let res = client.list("/", Depth::Number(1)).await?;
            let result = serde_json::to_string(&res)?;
            Ok(result)
        }
        "get" => {
            let res = client.get(&format!("/{}", name.unwrap())).await?;
            let data = res.bytes().await?;
            let config_dir_path = backup_config_dir()?;
            let zip_path = config_dir_path.join("archive.zip");

            let mut zip_file = std::fs::File::create(&zip_path)?;
            zip_file.write_all(&data)?;
            let mut zip_file = std::fs::File::open(&zip_path)?;
            let mut zip = ZipArchive::new(&mut zip_file)?;
            restore_archive(&mut zip, &config_dir_path)?;
            Ok("".to_string())
        }
        "put" => {
            let config_dir_path = backup_config_dir()?;
            let zip_path = config_dir_path.join("archive.zip");
            let config_path = config_dir_path.join("config.json");
            let database_path = config_dir_path.join("history.db");
            let plugin_path = config_dir_path.join("plugins");

            let zip_file = std::fs::File::create(&zip_path)?;
            let mut zip = zip::ZipWriter::new(zip_file);
            let options =
                SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
            zip.start_file("config.json", options)?;
            zip.write_all(&backup_config_bytes(&config_path)?)?;
            if database_path.exists() {
                zip.start_file("history.db", options)?;
                zip.write_all(&std::fs::read(&database_path)?)?;
            }
            if plugin_path.exists() {
                for entry in WalkDir::new(plugin_path) {
                    let entry = entry?;
                    let path = entry.path();
                    let file_name = match path.strip_prefix(&config_dir_path)?.to_str() {
                        Some(v) => v,
                        None => return Err(Error::Error("WebDav Strip Prefix Error".into())),
                    };
                    if path.is_file() {
                        info!("adding file {path:?} as {file_name:?} ...");
                        zip.start_file(file_name, options)?;
                        zip.write_all(&std::fs::read(entry.path())?)?;
                    } else {
                        continue;
                    }
                }
            }

            zip.finish()?;
            match client
                .put(&format!("/{}", name.unwrap()), std::fs::read(&zip_path)?)
                .await
            {
                Ok(()) => return Ok("".to_string()),
                Err(e) => {
                    return Err(Error::Error(format!("WebDav Put Error: {}", e).into()));
                }
            }
        }

        "delete" => match client.delete(&format!("/{}", name.unwrap())).await {
            Ok(()) => return Ok("".to_string()),
            Err(e) => {
                return Err(Error::Error(format!("WebDav Delete Error: {}", e).into()));
            }
        },
        _ => {
            return Err(Error::Error(
                format!("WebDav Operate Error: {}", operate).into(),
            ));
        }
    }
}

#[tauri::command(async)]
pub async fn local(operate: &str, path: String) -> Result<String, Error> {
    match operate {
        "put" => {
            let config_dir_path = backup_config_dir()?;
            let config_path = config_dir_path.join("config.json");
            let database_path = config_dir_path.join("history.db");
            let plugin_path = config_dir_path.join("plugins");

            let zip_file = std::fs::File::create(&path)?;
            let mut zip = zip::ZipWriter::new(zip_file);
            let options =
                SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
            zip.start_file("config.json", options)?;
            zip.write_all(&backup_config_bytes(&config_path)?)?;
            if database_path.exists() {
                zip.start_file("history.db", options)?;
                zip.write_all(&std::fs::read(&database_path)?)?;
            }
            if plugin_path.exists() {
                for entry in WalkDir::new(plugin_path) {
                    let entry = entry?;
                    let path = entry.path();
                    let file_name = match path.strip_prefix(&config_dir_path)?.to_str() {
                        Some(v) => v,
                        None => return Err(Error::Error("Strip Prefix Error".into())),
                    };
                    if path.is_file() {
                        info!("adding file {path:?} as {file_name:?} ...");
                        zip.start_file(file_name, options)?;
                        zip.write_all(&std::fs::read(entry.path())?)?;
                    } else {
                        continue;
                    }
                }
            }

            zip.finish()?;
            Ok("".to_string())
        }
        "get" => {
            let config_dir_path = backup_config_dir()?;

            let mut zip_file = std::fs::File::open(&path)?;
            let mut zip = ZipArchive::new(&mut zip_file)?;
            restore_archive(&mut zip, &config_dir_path)?;
            Ok("".to_string())
        }
        _ => {
            return Err(Error::Error(
                format!("Local Operate Error: {}", operate).into(),
            ));
        }
    }
}

pub(crate) fn backup_config_dir() -> Result<PathBuf, Error> {
    crate::APP
        .get()
        .and_then(|app| app.path_resolver().app_config_dir())
        .ok_or_else(|| Error::Error("无法获取应用配置目录".into()))
}

// Authorization credentials belong to this device and must not travel in cloud archives.
fn backup_config_bytes(path: &std::path::Path) -> Result<Vec<u8>, Error> {
    let mut value: serde_json::Value = serde_json::from_slice(&std::fs::read(path)?)?;
    if let Some(config) = value.as_object_mut() {
        for key in [
            "onedrive_credentials",
            "quark_token",
            "aliyun_access_token",
            "aliyun_refresh_token",
        ] {
            config.remove(key);
        }
    }
    Ok(serde_json::to_vec_pretty(&value)?)
}

pub(crate) fn restore_archive<R: std::io::Read + std::io::Seek>(
    zip: &mut ZipArchive<R>,
    destination: &std::path::Path,
) -> Result<(), Error> {
    // Validate the entire archive before touching the current configuration.
    let mut has_config = false;
    for index in 0..zip.len() {
        let mut file = zip.by_index(index)?;
        let path = file
            .enclosed_name()
            .ok_or_else(|| Error::Error("备份含有非法路径".into()))?;
        let name = path.to_string_lossy().replace('\\', "/");
        if name != "config.json"
            && name != "history.db"
            && name != "plugins"
            && !name.starts_with("plugins/")
        {
            return Err(Error::Error("备份包含不支持的文件".into()));
        }
        if file
            .unix_mode()
            .map_or(false, |mode| mode & 0o170000 == 0o120000)
        {
            return Err(Error::Error("备份不能包含符号链接".into()));
        }
        if name == "config.json" {
            let mut bytes = Vec::new();
            std::io::Read::read_to_end(&mut file, &mut bytes)?;
            let config: serde_json::Value = serde_json::from_slice(&bytes)?;
            if !config.is_object() {
                return Err(Error::Error("备份配置格式无效".into()));
            }
            has_config = true;
        } else {
            std::io::copy(&mut file, &mut std::io::sink())?;
        }
    }
    if !has_config {
        return Err(Error::Error("备份缺少 config.json".into()));
    }
    zip.extract(destination)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;
    use std::sync::atomic::{AtomicUsize, Ordering};
    static COUNTER: AtomicUsize = AtomicUsize::new(0);
    fn directory() -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "pot-backup-test-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&path).unwrap();
        path
    }
    fn archive(files: &[(&str, &[u8])]) -> ZipArchive<Cursor<Vec<u8>>> {
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (name, data) in files {
            writer
                .start_file(
                    *name,
                    SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored),
                )
                .unwrap();
            writer.write_all(data).unwrap();
        }
        ZipArchive::new(Cursor::new(writer.finish().unwrap().into_inner())).unwrap()
    }
    #[test]
    fn restores_config_history_and_plugins() {
        let path = directory();
        let mut zip = archive(&[
            ("config.json", br#"{"theme":"dark"}"#),
            ("history.db", b"history"),
            ("plugins/demo/info.json", b"{}"),
        ]);
        restore_archive(&mut zip, &path).unwrap();
        assert_eq!(std::fs::read(path.join("history.db")).unwrap(), b"history");
        assert_eq!(
            std::fs::read(path.join("plugins/demo/info.json")).unwrap(),
            b"{}"
        );
        std::fs::remove_dir_all(path).unwrap();
    }
    #[test]
    fn rejects_invalid_archives_before_overwriting_settings() {
        let path = directory();
        std::fs::write(path.join("config.json"), b"original").unwrap();
        for mut zip in [
            archive(&[("config.json", b"{}"), ("../outside.txt", b"bad")]),
            archive(&[("config.json", b"{}"), ("unrelated.txt", b"bad")]),
            archive(&[("config.json", b"[]")]),
            archive(&[("history.db", b"no config")]),
        ] {
            assert!(restore_archive(&mut zip, &path).is_err());
            assert_eq!(
                std::fs::read(path.join("config.json")).unwrap(),
                b"original"
            );
        }
        std::fs::remove_dir_all(path).unwrap();
    }
    #[test]
    fn backups_omit_cloud_authorization_but_keep_user_settings() {
        let path = directory();
        let config = path.join("config.json");
        std::fs::write(&config, br#"{"onedrive_credentials":{"access_token":"secret"},"quark_token":"secret","aliyun_access_token":"secret","aliyun_refresh_token":"secret","translate_target":"en","quark_backup_path":"/backup"}"#).unwrap();
        let value: serde_json::Value =
            serde_json::from_slice(&backup_config_bytes(&config).unwrap()).unwrap();
        assert_eq!(value["translate_target"], "en");
        assert_eq!(value["quark_backup_path"], "/backup");
        assert!(value.get("onedrive_credentials").is_none());
        assert!(value.get("quark_token").is_none());
        assert!(value.get("aliyun_access_token").is_none());
        assert!(value.get("aliyun_refresh_token").is_none());
        std::fs::remove_dir_all(path).unwrap();
    }
}
