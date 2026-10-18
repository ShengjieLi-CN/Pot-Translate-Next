// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod backup;
mod clipboard;
mod cmd;
mod config;
mod error;
mod hotkey;
mod lang_detect;
mod live_audio;
mod screenshot;
mod selection_translate;
mod server;
mod system_ocr;
mod tray;
mod updater;
mod window;
mod window_material;
mod libretranslate;

use backup::*;
use clipboard::*;
use cmd::*;
use config::*;
use hotkey::*;
use lang_detect::*;
use log::info;
use once_cell::sync::OnceCell;
use screenshot::{screenshot, screenshot_translate_mode};
use server::*;
use std::sync::Mutex;
use system_ocr::*;
use tauri::api::notification::Notification;
use tauri::Manager;
use tauri_plugin_log::LogTarget;
use tray::*;
use updater::check_update;
use window::config_window;
use window::updater_window;

// Global AppHandle
pub static APP: OnceCell<tauri::AppHandle> = OnceCell::new();

// Text to be translated
pub struct StringWrapper(pub Mutex<String>);

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, cwd| {
            Notification::new(&app.config().tauri.bundle.identifier)
                .title("The program is already running. Please do not start it again!")
                .body(cwd)
                .icon("pot")
                .show()
                .unwrap();
        }))
        .plugin(
            tauri_plugin_log::Builder::default()
                .targets([LogTarget::LogDir, LogTarget::Stdout])
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_fs_watch::init())
        .system_tray(tauri::SystemTray::new())
        .setup(|app| {
            info!("============== Start App ==============");
            #[cfg(target_os = "macos")]
            {
                app.set_activation_policy(tauri::ActivationPolicy::Accessory);
                let trusted =
                    macos_accessibility_client::accessibility::application_is_trusted_with_prompt();
                info!("MacOS Accessibility Trusted: {}", trusted);
            }
            // Global AppHandle
            APP.get_or_init(|| app.handle());
            // Init Config
            info!("Init Config Store");
            init_config(app);
            let first_run = is_first_run();
            libretranslate::register_default_service();
            // The maintained distribution uses Simplified Chinese UI and tray.
            if get("app_language").and_then(|v| v.as_str().map(str::to_owned)).as_deref() != Some("zh_cn") {
                set("app_language", "zh_cn");
            }
            // Check First Run
            if first_run {
                // Open Config Window
                info!("First Run, opening config window");
                config_window();
            }
            app.manage(StringWrapper(Mutex::new("".to_string())));
            // Update Tray Menu
            update_tray(app.app_handle(), "".to_string(), "".to_string());
            // Start http server
            start_server();
            // Register Global Shortcut
            match register_shortcut("all") {
                Ok(()) => {}
                Err(e) => Notification::new(app.config().tauri.bundle.identifier.clone())
                    .title("Failed to register global shortcut")
                    .body(&e)
                    .icon("pot")
                    .show()
                    .unwrap(),
            }
            match get("proxy_enable") {
                Some(v) => {
                    if v.as_bool().unwrap() && get("proxy_host").map_or(false, |host| !host.as_str().unwrap().is_empty()) {
                        let _ = set_proxy();
                    }
                }
                None => {}
            }
            // Check Update
            check_update(app.handle());
            if let Some(engine) = get("translate_detect_engine") {
                if engine.as_str().unwrap() == "local" {
                    init_lang_detect();
                }
            }
            let clipboard_monitor = match get("clipboard_monitor") {
                Some(v) => v.as_bool().unwrap(),
                None => {
                    set("clipboard_monitor", false);
                    false
                }
            };
            app.manage(ClipboardMonitorEnableWrapper(Mutex::new(
                clipboard_monitor.to_string(),
            )));
            start_clipboard_monitor(app.handle());
            selection_translate::start();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            libretranslate::libretranslate_status,
            libretranslate::libretranslate_install,
            libretranslate::libretranslate_translate,
            window_material::set_window_material,
            reload_store,
            selection_translate::selection_payload,
            selection_translate::selection_open,
            selection_translate::selection_dismiss,
            selection_translate::selection_status,
            selection_translate::selection_set_enabled,
            live_audio::live_audio_start,
            live_audio::live_audio_stop,
            live_audio::live_transcribe,
            get_text,
            cut_image,
            get_base64,
            copy_img,
            system_ocr,
            system_ocr_layout,
            screenshot_translate_mode,
            window::start_screenshot_translate,
            set_proxy,
            unset_proxy,
            run_binary,
            open_devtools,
            register_shortcut_by_frontend,
            update_tray,
            updater_window,
            screenshot,
            lang_detect,
            webdav,
            local,
            install_plugin,
            font_list,
            aliyun
        ])
        .on_system_tray_event(tray_event_handler)
        .on_window_event(|event| {
            if event.window().label() == "selection_translate" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event.event() {
                    api.prevent_close();
                    selection_translate::selection_dismiss();
                }
            }
            if matches!(event.event(), tauri::WindowEvent::Destroyed) { live_audio::stop_for_window(event.window().label()); }
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        // 窗口关闭不退出
        .run(|_app_handle, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                api.prevent_exit();
            }
        });
}
