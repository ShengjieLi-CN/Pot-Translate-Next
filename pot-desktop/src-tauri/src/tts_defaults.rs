use serde_json::{json, Map, Value};
use std::{fs::OpenOptions, io::Write, path::Path};

const PLUGIN: &str = "plugin.com.TechDecryptor.volcengine_tts";
const DEFAULT_INSTANCE: &str = "plugin.com.TechDecryptor.volcengine_tts@default";
pub const MIGRATION: &str = "tts_volcengine_default_v1";

// Run once on upgrade or a fresh profile; subsequent user ordering is respected.
pub fn migrate(settings: &mut Map<String, Value>) -> bool {
    if settings.get(MIGRATION) == Some(&json!(true)) {
        return false;
    }
    let mut list: Vec<String> = settings
        .get("tts_service_list")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .filter(|key| key.split('@').next() != Some("lingva_tts"))
        .map(str::to_owned)
        .collect();
    let key = list
        .iter()
        .find(|key| key.split('@').next() == Some(PLUGIN))
        .cloned()
        .unwrap_or_else(|| DEFAULT_INSTANCE.to_owned());
    list.retain(|existing| existing != &key);
    list.insert(0, key.clone());
    let mut config = settings
        .get(&key)
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    config.insert("enable".into(), json!(true));
    settings.insert(key, Value::Object(config));
    settings.insert("tts_service_list".into(), json!(list));
    settings.insert(MIGRATION.into(), json!(true));
    true
}

// Only fill absent files. Never replace an installed or customized plugin.
pub fn install_plugin(config_dir: &Path) -> std::io::Result<()> {
    let dir = config_dir.join("plugins/tts").join(PLUGIN);
    std::fs::create_dir_all(&dir)?;
    for (name, contents) in [
        (
            "info.json",
            include_str!("../bundled-plugins/volcengine-tts/info.json"),
        ),
        (
            "main.js",
            include_str!("../bundled-plugins/volcengine-tts/main.js"),
        ),
        (
            "volcengine.svg",
            include_str!("../bundled-plugins/volcengine-tts/volcengine.svg"),
        ),
        (
            "LICENSE",
            include_str!("../bundled-plugins/volcengine-tts/LICENSE"),
        ),
        (
            "NOTICE.md",
            include_str!("../bundled-plugins/volcengine-tts/NOTICE.md"),
        ),
    ] {
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(dir.join(name))
        {
            Ok(mut file) => file.write_all(contents.as_bytes())?,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(error),
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fresh_profile_has_enabled_default() {
        let mut settings = Map::new();
        assert!(migrate(&mut settings));
        assert_eq!(settings["tts_service_list"], json!([DEFAULT_INSTANCE]));
        assert_eq!(settings[DEFAULT_INSTANCE]["enable"], true);
    }

    #[test]
    fn upgrade_preserves_voice_and_other_services_without_duplicate_instances() {
        let key = format!("{PLUGIN}@existing");
        let mut settings = json!({
            "tts_service_list": ["lingva_tts", "plugin.youdao@test", key, "lingva_tts@old", "plugin.windows@test"],
            "unrelated": {"model": "preserve-me"}
        }).as_object().unwrap().clone();
        settings.insert(
            key.clone(),
            json!({"enable": false, "en-speaker": "en_male_bob", "instanceName": "My voice"}),
        );
        migrate(&mut settings);
        assert_eq!(
            settings["tts_service_list"],
            json!([key, "plugin.youdao@test", "plugin.windows@test"])
        );
        assert_eq!(
            settings[&key],
            json!({"enable": true, "en-speaker": "en_male_bob", "instanceName": "My voice"})
        );
        assert_eq!(settings["unrelated"], json!({"model": "preserve-me"}));
        assert!(!settings.contains_key(DEFAULT_INSTANCE));
        settings.insert(
            "tts_service_list".into(),
            json!(["plugin.youdao@test", key]),
        );
        let reordered = settings.clone();
        assert!(!migrate(&mut settings));
        assert_eq!(settings, reordered);
    }

    #[test]
    fn bundled_plugin_installs_without_overwriting_existing_files() {
        let dir = std::env::temp_dir().join(format!("pot-tts-test-{}", uuid::Uuid::new_v4()));
        install_plugin(&dir).unwrap();
        let plugin = dir.join("plugins/tts").join(PLUGIN);
        let info: Value =
            serde_json::from_slice(&std::fs::read(plugin.join("info.json")).unwrap()).unwrap();
        assert_eq!(info["id"], PLUGIN);
        assert_eq!(info["plugin_type"], "tts");
        assert!(std::fs::read_to_string(plugin.join("main.js"))
            .unwrap()
            .contains("async function tts"));
        std::fs::write(plugin.join("main.js"), "custom-plugin").unwrap();
        install_plugin(&dir).unwrap();
        assert_eq!(
            std::fs::read_to_string(plugin.join("main.js")).unwrap(),
            "custom-plugin"
        );
        std::fs::remove_dir_all(dir).unwrap();
    }
}
