use log::info;
use std::sync::atomic::{AtomicBool, Ordering};

static TRANSLATE_MODE: AtomicBool = AtomicBool::new(false);

pub fn set_translate_mode(translate: bool) {
    TRANSLATE_MODE.store(translate, Ordering::SeqCst);
}

#[tauri::command]
pub fn screenshot_translate_mode() -> bool {
    TRANSLATE_MODE.load(Ordering::SeqCst)
}

#[tauri::command]
pub fn screenshot(x: i32, y: i32) -> Result<(), String> {
    use crate::APP;
    use dirs::cache_dir;
    use screenshots::{Compression, Screen};
    use std::fs;
    info!("Screenshot screen with position: x={}, y={}", x, y);
    let screens = Screen::all().map_err(|e| e.to_string())?;
    for screen in screens {
        let info = screen.display_info;
        info!("Screen: {:?}", info);
        if info.x == x && info.y == y {
            let handle = APP.get().unwrap();
            let mut app_cache_dir_path = cache_dir().expect("Get Cache Dir Failed");
            app_cache_dir_path.push(&handle.config().tauri.bundle.identifier);
            if !app_cache_dir_path.exists() {
                // 创建目录
                fs::create_dir_all(&app_cache_dir_path).expect("Create Cache Dir Failed");
            }
            app_cache_dir_path.push("pot_screenshot.png");

            let image = screen.capture().map_err(|e| e.to_string())?;
            let buffer = image.to_png(Compression::Fast).map_err(|e| e.to_string())?;
            fs::write(app_cache_dir_path, buffer).map_err(|e| e.to_string())?;
            return Ok(());
        }
    }
    Err("Screenshot monitor not found".to_string())
}
