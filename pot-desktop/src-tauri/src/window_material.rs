use tauri::Window;

// Screenshot capture must keep its own transparent overlay and pixel colours.
#[tauri::command]
pub fn set_window_material(window: Window, material: String, dark: bool) -> Result<(), String> {
    if !["none", "mica", "acrylic", "liquid"].contains(&material.as_str()) {
        return Err("未知的窗口材质。".into());
    }
    if ![
        "config",
        "translate",
        "recognize",
        "updater",
        "selection_translate",
        "image_translate",
    ]
    .contains(&window.label())
    {
        return Ok(());
    }
    #[cfg(target_os = "windows")]
    {
        use std::ffi::c_void;
        #[link(name = "dwmapi")]
        extern "system" {
            fn DwmSetWindowAttribute(
                hwnd: isize,
                attribute: u32,
                value: *const c_void,
                size: u32,
            ) -> i32;
        }
        let hwnd = window.hwnd().map_err(|_| "无法获取窗口句柄。")?.0;
        let backdrop: i32 = match material.as_str() {
            "mica" => 2,               // DWMSBT_MAINWINDOW
            "acrylic" | "liquid" => 3, // DWMSBT_TRANSIENTWINDOW
            _ => 1,                    // DWMSBT_NONE
        };
        let dark = i32::from(dark);
        // Frameless Tauri windows already configure their non-client area and shadow.
        // Extending the frame with negative margins makes DWM paint native caption
        // buttons under our transparent custom toolbar. Set only the backdrop type.
        unsafe {
            let _ = DwmSetWindowAttribute(hwnd, 20, &dark as *const _ as _, 4);
            let result = DwmSetWindowAttribute(hwnd, 38, &backdrop as *const _ as _, 4);
            if result < 0 && backdrop != 1 {
                return Err("当前系统不支持此背景材质，已使用不透明背景（需要 Windows 11 22H2 或更高版本）。".into());
            }
        }
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = dark;
        if material == "none" {
            Ok(())
        } else {
            Err("此窗口材质需要 Windows 11，已使用不透明背景。".into())
        }
    }
}
