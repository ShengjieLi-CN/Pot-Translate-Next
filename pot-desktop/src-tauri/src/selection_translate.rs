use crate::{config, APP};
use once_cell::sync::Lazy;
use serde::Serialize;
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Mutex,
};
use tauri::Manager;

static ENABLED: AtomicBool = AtomicBool::new(true);
static NEXT_ID: AtomicU64 = AtomicU64::new(1);
static CURRENT: Lazy<Mutex<Option<Selection>>> = Lazy::new(|| Mutex::new(None));
static LAST_ERROR: Lazy<Mutex<Option<String>>> = Lazy::new(|| Mutex::new(None));
static LISTENING: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextStyle {
    font_family: Option<String>,
    font_size: Option<f64>,
    bold: Option<bool>,
    italic: Option<bool>,
}

#[derive(Clone, Default, Serialize)]
pub struct TextRun {
    text: String,
    style: TextStyle,
}

#[derive(Clone, Serialize)]
pub struct Selection {
    id: u64,
    mode: String,
    runs: Vec<TextRun>,
    x: i32,
    y: i32,
    #[serde(skip)]
    source_window: isize,
    #[serde(rename = "captureError")]
    capture_error: Option<String>,
}

fn set_badge_activation(window: &tauri::Window, badge: bool) {
    #[cfg(target_os = "windows")]
    unsafe {
        use windows::Win32::{
            Foundation::HWND,
            UI::WindowsAndMessaging::{
                GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_NOACTIVATE,
            },
        };
        if let Ok(handle) = window.hwnd() {
            let hwnd = HWND(handle.0 as *mut _);
            let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            let flag = WS_EX_NOACTIVATE.0 as isize;
            SetWindowLongPtrW(
                hwnd,
                GWL_EXSTYLE,
                if badge { style | flag } else { style & !flag },
            );
        }
    }
}

fn show_selection_window(window: &tauri::Window, result: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    if !result {
        // Tauri show() may activate an existing window. A badge must preserve
        // the source application's focus and selection on every appearance.
        use windows::Win32::{
            Foundation::HWND,
            UI::WindowsAndMessaging::{ShowWindow, SW_SHOWNOACTIVATE},
        };
        let handle = window.hwnd().map_err(|e| e.to_string())?;
        unsafe {
            let _ = ShowWindow(HWND(handle.0 as *mut _), SW_SHOWNOACTIVATE);
        }
        return Ok(());
    }
    window.show().map_err(|e| e.to_string())
}

fn selection_window() -> Result<tauri::Window, String> {
    let app = APP.get().unwrap();
    if let Some(window) = app.get_window("selection_translate") {
        return Ok(window);
    }
    tauri::WindowBuilder::new(
        app,
        "selection_translate",
        tauri::WindowUrl::App("index.html".into()),
    )
    .title("Selection Translation")
    .decorations(false)
    .transparent(true)
    .visible(false)
    .focused(false)
    .skip_taskbar(true)
    .always_on_top(true)
    .resizable(true)
    .inner_size(62.0, 36.0)
    .build()
    .map_err(|e| e.to_string())
}

fn position_window(window: &tauri::Window, x: i32, y: i32, result: bool) {
    let monitors = window.available_monitors().unwrap_or_default();
    let monitor = monitors.iter().find(|m| {
        let p = m.position();
        let s = m.size();
        x >= p.x && y >= p.y && x < p.x + s.width as i32 && y < p.y + s.height as i32
    });
    if let Some(m) = monitor {
        let dpi = m.scale_factor();
        let width = ((if result { 520.0 } else { 62.0 }) * dpi).min(m.size().width as f64 - 24.0);
        let height = ((if result { 360.0 } else { 36.0 }) * dpi).min(m.size().height as f64 - 64.0);
        let p = m.position();
        let left = (x + (12.0 * dpi) as i32)
            .clamp(p.x + 8, p.x + m.size().width as i32 - width as i32 - 8);
        let top = (y + (14.0 * dpi) as i32)
            .clamp(p.y + 8, p.y + m.size().height as i32 - height as i32 - 48);
        let _ = window.set_size(tauri::PhysicalSize::new(width, height));
        let _ = window.set_position(tauri::PhysicalPosition::new(left, top));
    }
}

fn publish(
    runs: Vec<TextRun>,
    x: i32,
    y: i32,
    result: bool,
    source_window: isize,
) -> Result<u64, String> {
    if result && runs.iter().all(|r| r.text.trim().is_empty()) {
        return Err("请先选中需要翻译的文字。".into());
    }
    if runs.iter().map(|r| r.text.chars().count()).sum::<usize>() > 20_000 {
        return Err("一次最多翻译 20000 个字符，请缩小选择范围。".into());
    }
    let payload = Selection {
        id: NEXT_ID.fetch_add(1, Ordering::SeqCst),
        mode: if result { "result" } else { "badge" }.into(),
        runs,
        x,
        y,
        source_window,
        capture_error: None,
    };
    let window = selection_window()?;
    *CURRENT.lock().unwrap() = Some(payload.clone());
    position_window(&window, x, y, result);
    set_badge_activation(&window, !result);
    let _ = window.emit("selection_changed", &payload);
    show_selection_window(&window, result)?;
    if result {
        let _ = window.set_focus();
    }
    Ok(payload.id)
}

#[tauri::command]
pub fn selection_payload() -> Option<Selection> {
    CURRENT.lock().unwrap().clone()
}

#[tauri::command]
pub async fn selection_open(id: u64) -> Result<(), String> {
    let mut payload = CURRENT
        .lock()
        .unwrap()
        .as_ref()
        .filter(|s| s.id == id)
        .cloned()
        .ok_or("选中文字已失效，请重新划词。")?;
    payload.capture_error = None;
    {
        let mut state = CURRENT.lock().unwrap();
        let pending = state
            .as_mut()
            .filter(|s| s.id == id)
            .ok_or("选中文字已失效，请重新划词。")?;
        if pending.mode == "capturing" {
            return Err("正在读取选中文字，请稍候。".into());
        }
        pending.mode = "capturing".into();
        payload.mode = "capturing".into();
    }
    // Show progress immediately without activating the popup: activating here
    // would move focus away from the document before UIA/clipboard capture.
    let window = selection_window()?;
    set_badge_activation(&window, true);
    position_window(&window, payload.x, payload.y, true);
    let _ = window.emit("selection_changed", &payload);
    show_selection_window(&window, false)?;
    if payload.runs.is_empty() {
        #[cfg(target_os = "windows")]
        {
            let source = payload.source_window;
            let point = (payload.x, payload.y);
            // The badge is nonactivating. Read/copy from the saved source app,
            // never the translation WebView. Clipboard fallback needs an explicit click.
            match tauri::async_runtime::spawn_blocking(move || {
                if CURRENT.lock().unwrap().as_ref().map(|s| s.id) != Some(id) {
                    return Err("选中文字已失效，请重新划词。".into());
                }
                platform::read_on_request(source, point, id)
            })
            .await
            {
                Ok(Ok(runs)) => payload.runs = runs,
                Ok(Err(error)) => payload.capture_error = Some(error),
                Err(error) => {
                    payload.capture_error = Some(format!("取词失败，请重新划词：{error}"))
                }
            }
        }
    }
    payload.mode = "result".into();
    let mut state = CURRENT.lock().unwrap();
    if state.as_ref().map(|s| s.id) != Some(id) {
        return Err("选中文字已失效，请重新划词。".into());
    }
    *state = Some(payload.clone());
    drop(state);
    let window = selection_window()?;
    set_badge_activation(&window, false);
    position_window(&window, payload.x, payload.y, true);
    let _ = window.emit("selection_changed", payload);
    let _ = window.show();
    let _ = window.set_focus();
    Ok(())
}

#[tauri::command]
pub fn selection_dismiss() {
    *CURRENT.lock().unwrap() = None;
    if let Some(window) = APP.get().unwrap().get_window("selection_translate") {
        let _ = window.emit("selection_changed", Option::<Selection>::None);
        #[cfg(target_os = "windows")]
        if let Ok(handle) = window.hwnd() {
            // Also hide badges shown without changing Tauri's visible flag.
            use windows::Win32::{
                Foundation::HWND,
                UI::WindowsAndMessaging::{ShowWindow, SW_HIDE},
            };
            unsafe {
                let _ = ShowWindow(HWND(handle.0 as *mut _), SW_HIDE);
            }
        }
        let _ = window.hide();
    }
}

#[tauri::command]
pub fn selection_status() -> serde_json::Value {
    serde_json::json!({ "enabled": ENABLED.load(Ordering::Relaxed), "supported": cfg!(target_os = "windows"), "listening": LISTENING.load(Ordering::Relaxed), "lastError": LAST_ERROR.lock().unwrap().clone() })
}

#[tauri::command]
pub fn selection_set_enabled(enabled: bool) {
    ENABLED.store(enabled, Ordering::Relaxed);
    config::set("selection_translate_enabled", enabled);
    if !enabled {
        selection_dismiss();
    }
}

pub fn from_shortcut() {
    #[cfg(target_os = "windows")]
    {
        let source = platform::foreground_source();
        let (x, y) = match mouse_position::mouse_position::Mouse::get_mouse_position() {
            mouse_position::mouse_position::Mouse::Position { x, y } => (x, y),
            _ => (0, 0),
        };
        // Use the same bounded capture and visible error/retry flow as the badge.
        // Capture the document handle before opening any of our own windows.
        match publish(vec![], x, y, false, source) {
            Ok(id) => {
                tauri::async_runtime::spawn(async move {
                    if let Err(error) = selection_open(id).await {
                        log::warn!("Selection shortcut: {error}");
                    }
                });
            }
            Err(error) => log::warn!("Selection shortcut: {error}"),
        }
    }
    #[cfg(not(target_os = "windows"))]
    std::thread::spawn(|| {
        let runs = vec![TextRun {
            text: selection::get_text(),
            style: TextStyle::default(),
        }];
        let (x, y) = match mouse_position::mouse_position::Mouse::get_mouse_position() {
            mouse_position::mouse_position::Mouse::Position { x, y } => (x, y),
            _ => (0, 0),
        };
        if let Err(e) = publish(runs, x, y, true, 0) {
            log::warn!("Selection translation: {}", e);
        }
    });
}

pub fn start() {
    ENABLED.store(
        config::get("selection_translate_enabled")
            .and_then(|v| v.as_bool())
            .unwrap_or(true),
        Ordering::Relaxed,
    );
    // Prepare the tiny nonactivating window before the first selection.
    if let Err(error) = selection_window() {
        *LAST_ERROR.lock().unwrap() = Some(error);
    }
    #[cfg(target_os = "windows")]
    std::thread::spawn(platform::watch);
}

#[cfg(target_os = "windows")]
mod platform {
    use super::*;
    use std::sync::mpsc::{self, SyncSender};
    use std::time::{Duration, Instant};
    use windows::{
        core::{Interface, BSTR, VARIANT},
        Win32::{
            Foundation::{HWND, LPARAM, LRESULT, POINT, WPARAM},
            System::Com::{
                CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
                COINIT_MULTITHREADED,
            },
            System::LibraryLoader::GetModuleHandleW,
            UI::{
                Accessibility::*,
                WindowsAndMessaging::{
                    GetForegroundWindow, GetWindowThreadProcessId, IsWindow, SetForegroundWindow,
                },
            },
        },
    };

    use windows::Win32::UI::WindowsAndMessaging as wm;
    static UIA_BUSY: AtomicBool = AtomicBool::new(false);

    pub fn foreground_source() -> isize {
        unsafe { GetForegroundWindow().0 as isize }
    }

    fn own_window(source: isize) -> bool {
        let mut pid = 0;
        unsafe {
            GetWindowThreadProcessId(HWND(source as *mut _), Some(&mut pid));
        }
        pid == std::process::id()
    }

    unsafe fn style(range: &IUIAutomationTextRange) -> TextStyle {
        // Unknown and mixed attributes remain absent; don't invent source formatting.
        TextStyle {
            font_family: range
                .GetAttributeValue(UIA_FontNameAttributeId)
                .ok()
                .and_then(|v| BSTR::try_from(&v).ok())
                .map(|s| s.to_string())
                .filter(|s| s.len() < 160),
            font_size: range
                .GetAttributeValue(UIA_FontSizeAttributeId)
                .ok()
                .and_then(|v| f64::try_from(&v).ok())
                .filter(|v| v.is_finite() && *v > 0.0 && *v <= 200.0),
            bold: range
                .GetAttributeValue(UIA_FontWeightAttributeId)
                .ok()
                .and_then(|v| i32::try_from(&v).ok())
                .map(|v| v >= 600),
            italic: range
                .GetAttributeValue(UIA_IsItalicAttributeId)
                .ok()
                .and_then(|v| bool::try_from(&v).ok()),
        }
    }

    unsafe fn read_element(el: &IUIAutomationElement) -> windows::core::Result<Vec<TextRun>> {
        if el.CurrentIsPassword()?.as_bool() {
            return Ok(vec![]);
        }
        let pattern: IUIAutomationTextPattern = el.GetCurrentPatternAs(UIA_TextPatternId)?;
        let ranges = pattern.GetSelection()?;
        let mut runs = vec![];
        let mut count = 0;
        for i in 0..ranges.Length()?.min(16) {
            let selected = ranges.GetElement(i)?;
            let full = selected.GetText(20_001)?.to_string();
            if full.trim().is_empty() {
                continue;
            }
            count += full.chars().count();
            if count > 20_000 {
                return Ok(vec![]);
            }
            let formats = read_formats(&selected).unwrap_or_default();
            if i > 0 {
                runs.push(TextRun {
                    text: "\n\n".into(),
                    style: TextStyle::default(),
                });
            }
            if formats.iter().map(|r| r.text.as_str()).collect::<String>() == full {
                runs.extend(formats);
            } else {
                runs.push(TextRun {
                    text: full,
                    style: style(&selected),
                });
            }
        }
        Ok(runs)
    }

    unsafe fn read_formats(
        selected: &IUIAutomationTextRange,
    ) -> windows::core::Result<Vec<TextRun>> {
        let mut formats = vec![];
        let range = selected.Clone()?;
        range.MoveEndpointByRange(
            TextPatternRangeEndpoint_End,
            selected,
            TextPatternRangeEndpoint_Start,
        )?;
        for _ in 0..128 {
            if range.CompareEndpoints(
                TextPatternRangeEndpoint_Start,
                selected,
                TextPatternRangeEndpoint_End,
            )? >= 0
            {
                break;
            }
            if range
                .MoveEndpointByUnit(TextPatternRangeEndpoint_End, TextUnit_Format, 1)
                .unwrap_or(0)
                == 0
            {
                break;
            }
            if range.CompareEndpoints(
                TextPatternRangeEndpoint_End,
                selected,
                TextPatternRangeEndpoint_End,
            )? > 0
            {
                range.MoveEndpointByRange(
                    TextPatternRangeEndpoint_End,
                    selected,
                    TextPatternRangeEndpoint_End,
                )?;
            }
            let text = range.GetText(20_001)?.to_string();
            if text.is_empty() {
                break;
            }
            formats.push(TextRun {
                text,
                style: style(&range),
            });
            range.MoveEndpointByRange(
                TextPatternRangeEndpoint_Start,
                &range,
                TextPatternRangeEndpoint_End,
            )?;
        }
        Ok(formats)
    }

    unsafe fn capture(point: Option<POINT>) -> windows::core::Result<Vec<TextRun>> {
        let auto: IUIAutomation = CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER)?;
        if let Ok(timed) = auto.cast::<IUIAutomation2>() {
            let _ = timed.SetConnectionTimeout(500);
            let _ = timed.SetTransactionTimeout(1000);
        }
        let focused = auto.GetFocusedElement()?;
        if focused.CurrentIsPassword()?.as_bool() {
            return Ok(vec![]);
        }
        let mut roots = vec![];
        if let Some(point) = point {
            if let Ok(element) = auto.ElementFromPoint(point) {
                roots.push(element);
            }
        }
        roots.push(focused);
        for root in roots {
            let walker = auto.ControlViewWalker()?;
            let mut element = root;
            for _ in 0..6 {
                if element.CurrentProcessId().ok() == Some(std::process::id() as i32) {
                    // A progress popup can overlap the saved mouse position.
                    // Continue with the focused source document, not our WebView.
                    break;
                }
                if element.CurrentProcessId().ok() == Some(0) {
                    break;
                }
                if let Ok(runs) = read_element(&element) {
                    if !runs.is_empty() {
                        return Ok(runs);
                    }
                }
                // Some PDF viewers focus a container rather than its text document.
                let condition = auto.CreatePropertyCondition(
                    UIA_IsTextPatternAvailablePropertyId,
                    &VARIANT::from(true),
                )?;
                if let Ok(children) = element.FindAll(TreeScope_Children, &condition) {
                    for i in 0..children.Length()?.min(24) {
                        if let Ok(runs) = read_element(&children.GetElement(i)?) {
                            if !runs.is_empty() {
                                return Ok(runs);
                            }
                        }
                    }
                }
                // Browser/PDF document nodes can be several levels below the focused pane.
                if let Ok(document) = element.FindFirst(TreeScope_Descendants, &condition) {
                    if let Ok(runs) = read_element(&document) {
                        if !runs.is_empty() {
                            return Ok(runs);
                        }
                    }
                }
                match walker.GetParentElement(&element) {
                    Ok(parent) => element = parent,
                    Err(_) => break,
                }
            }
        }
        Ok(vec![])
    }

    pub fn read_selected(point: Option<POINT>) -> Result<Vec<TextRun>, String> {
        unsafe {
            CoInitializeEx(None, COINIT_MULTITHREADED)
                .ok()
                .map_err(|e| e.to_string())?;
            let result = capture(point).map_err(|e| e.to_string());
            CoUninitialize();
            result
        }
    }

    fn read_with_timeout(point: POINT) -> Result<Vec<TextRun>, String> {
        // Some PDF accessibility providers block indefinitely despite UIA's
        // transaction timeout. Keep the popup responsive and allow copy fallback.
        // Only one UIA worker can be outstanding, including after a timeout.
        if UIA_BUSY
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return Err("文档取词尚未响应，尝试兼容复制取词。".into());
        }
        let (sender, receiver) = mpsc::sync_channel(1);
        std::thread::spawn(move || {
            let result = read_selected(Some(point));
            UIA_BUSY.store(false, Ordering::SeqCst);
            let _ = sender.send(result);
        });
        receiver
            .recv_timeout(Duration::from_millis(1800))
            .map_err(|_| "文档取词超时，尝试兼容复制取词。".to_string())?
    }

    pub fn read_on_request(
        source: isize,
        point: (i32, i32),
        id: u64,
    ) -> Result<Vec<TextRun>, String> {
        let hwnd = HWND(source as *mut _);
        unsafe {
            if !IsWindow(hwnd).as_bool() {
                return Err("原文窗口已关闭，请重新选中文字。".into());
            }
            if GetForegroundWindow() != hwnd {
                let _ = SetForegroundWindow(hwnd);
                std::thread::sleep(Duration::from_millis(80));
            }
            if GetForegroundWindow() != hwnd {
                return Err("无法回到原文窗口，请在原文中重新划词，或使用划词翻译快捷键。".into());
            }
        }
        let selected = read_with_timeout(POINT {
            x: point.0,
            y: point.1,
        });
        if CURRENT.lock().unwrap().as_ref().map(|s| s.id) != Some(id) {
            return Err("选中文字已失效，请重新划词。".into());
        }
        if unsafe { GetForegroundWindow() } != hwnd {
            return Err("原文窗口已切换，请重新划词。".into());
        }
        if let Ok(runs) = selected {
            if !runs.is_empty() {
                return Ok(runs);
            }
        }
        if unsafe { GetForegroundWindow() } != hwnd {
            return Err("原文窗口已切换，请重新划词。".into());
        }
        // Existing compatibility library restores the previous clipboard contents.
        let text = selection::get_text();
        if text.trim().is_empty() {
            return Err("未读取到选中文字。请确认文字可以复制，重新划词或使用截图翻译。".into());
        }
        if text.chars().count() > 20_000 {
            return Err("一次最多翻译 20000 个字符，请缩小选择范围。".into());
        }
        Ok(vec![TextRun {
            text,
            style: TextStyle::default(),
        }])
    }

    fn fallback_candidate(point: POINT) -> bool {
        unsafe {
            let child = wm::WindowFromPoint(point);
            let root = wm::GetAncestor(child, wm::GA_ROOT);
            let mut info = wm::WINDOWINFO {
                cbSize: std::mem::size_of::<wm::WINDOWINFO>() as u32,
                ..Default::default()
            };
            if wm::GetWindowInfo(root, &mut info).is_err() {
                return false;
            }
            if point.x < info.rcClient.left
                || point.y < info.rcClient.top
                || point.x >= info.rcClient.right
                || point.y >= info.rcClient.bottom
            {
                return false;
            }
            let mut name = [0u16; 128];
            let length = wm::GetClassNameW(child, &mut name);
            let name = String::from_utf16_lossy(&name[..length.max(0) as usize]).to_lowercase();
            if [
                "scrollbar",
                "button",
                "toolbar",
                "syslistview32",
                "systreeview32",
                "trackbar",
                "combobox",
            ]
            .iter()
            .any(|class| name.contains(class))
            {
                return false;
            }
            // Standard password edits never offer a badge.
            if name.contains("edit") && wm::GetWindowLongPtrW(child, wm::GWL_STYLE) & 0x20 != 0 {
                return false;
            }
            true
        }
    }

    fn over_popup(point: POINT) -> bool {
        if let Some(window) = APP.get().unwrap().get_window("selection_translate") {
            if window.is_visible().unwrap_or(false) {
                if let (Ok(p), Ok(s)) = (window.outer_position(), window.outer_size()) {
                    return point.x >= p.x
                        && point.y >= p.y
                        && point.x < p.x + s.width as i32
                        && point.y < p.y + s.height as i32;
                }
            }
        }
        false
    }

    #[derive(Clone, Copy)]
    struct MouseEvent {
        down: bool,
        point: POINT,
        source: isize,
        time: u32,
        generation: u64,
    }

    static HOOK_SENDER: Lazy<Mutex<Option<SyncSender<MouseEvent>>>> =
        Lazy::new(|| Mutex::new(None));
    static GESTURE_GENERATION: AtomicU64 = AtomicU64::new(0);

    // Hook callbacks only enqueue down/up events; UIA, clipboard and window work
    // run on a separate worker so slow providers cannot swallow mouse gestures.
    unsafe extern "system" fn mouse_hook(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code >= 0 && [wm::WM_LBUTTONDOWN, wm::WM_LBUTTONUP].contains(&(wparam.0 as u32)) {
            let data = &*(lparam.0 as *const wm::MSLLHOOKSTRUCT);
            let down = wparam.0 as u32 == wm::WM_LBUTTONDOWN;
            let generation = if down {
                GESTURE_GENERATION.fetch_add(1, Ordering::Relaxed) + 1
            } else {
                GESTURE_GENERATION.load(Ordering::Relaxed)
            };
            let source = wm::GetAncestor(wm::WindowFromPoint(data.pt), wm::GA_ROOT).0 as isize;
            if let Ok(sender) = HOOK_SENDER.try_lock() {
                if let Some(sender) = sender.as_ref() {
                    let _ = sender.try_send(MouseEvent {
                        down,
                        point: data.pt,
                        source,
                        time: data.time,
                        generation,
                    });
                }
            }
        }
        wm::CallNextHookEx(None, code, wparam, lparam)
    }

    fn hook_loop() {
        unsafe {
            let hook = GetModuleHandleW(None).and_then(|module| {
                wm::SetWindowsHookExW(wm::WH_MOUSE_LL, Some(mouse_hook), module, 0)
            });
            match hook {
                Ok(hook) => {
                    LISTENING.store(true, Ordering::Relaxed);
                    let mut msg = wm::MSG::default();
                    while wm::GetMessageW(&mut msg, None, 0, 0).0 > 0 {
                        let _ = wm::TranslateMessage(&msg);
                        wm::DispatchMessageW(&msg);
                    }
                    let _ = wm::UnhookWindowsHookEx(hook);
                }
                Err(error) => {
                    *LAST_ERROR.lock().unwrap() = Some(format!("无法启动划词鼠标监听：{error}"))
                }
            }
            LISTENING.store(false, Ordering::Relaxed);
        }
    }

    #[derive(Default)]
    struct GestureTracker {
        down: Option<MouseEvent>,
        last_up: Option<MouseEvent>,
    }

    impl GestureTracker {
        fn accept(&mut self, event: MouseEvent) -> bool {
            if event.down {
                self.down = Some(event);
                return false;
            }
            let start = self.down.take();
            let dragged = start.map_or(false, |start| {
                start.source == event.source
                    && ((start.point.x - event.point.x).abs() > 4
                        || (start.point.y - event.point.y).abs() > 4)
            });
            let double_clicked = self.last_up.map_or(false, |previous| {
                previous.source == event.source
                    && event.time.wrapping_sub(previous.time) < 500
                    && (previous.point.x - event.point.x).abs() < 5
                    && (previous.point.y - event.point.y).abs() < 5
            });
            self.last_up = Some(event);
            dragged || double_clicked
        }
    }

    pub fn watch() {
        let (sender, receiver) = mpsc::sync_channel(128);
        *HOOK_SENDER.lock().unwrap() = Some(sender);
        std::thread::spawn(hook_loop);
        let mut gestures = GestureTracker::default();
        let mut badge_shown = None::<Instant>;
        loop {
            if let Ok(event) = receiver.recv_timeout(Duration::from_millis(100)) {
                if !ENABLED.load(Ordering::Relaxed) {
                    gestures = GestureTracker::default();
                    continue;
                }
                if own_window(event.source) || over_popup(event.point) {
                    gestures = GestureTracker::default();
                    continue;
                }
                if event.down {
                    selection_dismiss();
                    badge_shown = None;
                }
                let selected = gestures.accept(event);
                if selected
                    && event.generation == GESTURE_GENERATION.load(Ordering::Relaxed)
                    && fallback_candidate(event.point)
                    && unsafe { GetForegroundWindow().0 as isize } == event.source
                {
                    // Offer the action immediately, even for PDF viewers without
                    // UIA TextPattern. Read only after the user clicks Translate.
                    match publish(vec![], event.point.x, event.point.y, false, event.source) {
                        Ok(_) => {
                            badge_shown = Some(Instant::now());
                            *LAST_ERROR.lock().unwrap() = None;
                        }
                        Err(error) => {
                            log::warn!("Selection badge could not be shown: {error}");
                            *LAST_ERROR.lock().unwrap() = Some(error);
                        }
                    }
                }
            }
            if badge_shown.map_or(false, |time| time.elapsed() > Duration::from_secs(10)) {
                let badge = CURRENT
                    .lock()
                    .unwrap()
                    .as_ref()
                    .map_or(false, |p| p.mode == "badge");
                if badge {
                    selection_dismiss();
                }
                badge_shown = None;
            }
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        fn event(down: bool, x: i32, y: i32, time: u32, source: isize) -> MouseEvent {
            MouseEvent {
                down,
                point: POINT { x, y },
                source,
                time,
                generation: 0,
            }
        }
        #[test]
        fn fast_drag_and_reverse_drag_are_not_lost_between_poll_intervals() {
            let mut gesture = GestureTracker::default();
            assert!(!gesture.accept(event(true, 10, 10, 100, 1)));
            assert!(gesture.accept(event(false, 100, 10, 106, 1)));
            gesture.accept(event(true, 100, 50, 900, 1));
            assert!(gesture.accept(event(false, 10, 10, 906, 1)));
        }
        #[test]
        fn double_clicks_work_but_single_clicks_and_other_windows_do_not() {
            let mut gesture = GestureTracker::default();
            gesture.accept(event(true, 20, 20, 10, 1));
            assert!(!gesture.accept(event(false, 20, 20, 50, 1)));
            gesture.accept(event(true, 20, 20, 100, 1));
            assert!(gesture.accept(event(false, 20, 20, 140, 1)));
            gesture.accept(event(true, 20, 20, 200, 2));
            assert!(!gesture.accept(event(false, 20, 20, 240, 2)));
        }
        #[test]
        fn click_timing_survives_windows_tick_rollover() {
            let mut gesture = GestureTracker::default();
            gesture.accept(event(true, 20, 20, u32::MAX - 100, 1));
            assert!(!gesture.accept(event(false, 20, 20, u32::MAX - 50, 1)));
            gesture.accept(event(true, 20, 20, 20, 1));
            assert!(gesture.accept(event(false, 20, 20, 60, 1)));
        }

        #[test]
        fn native_mouse_hook_can_be_registered_and_removed() {
            unsafe {
                let module = GetModuleHandleW(None).expect("Current application module");
                let hook = wm::SetWindowsHookExW(wm::WH_MOUSE_LL, Some(mouse_hook), module, 0)
                    .expect("Register mouse hook");
                wm::UnhookWindowsHookEx(hook).expect("Remove mouse hook");
            }
        }
    }
}
