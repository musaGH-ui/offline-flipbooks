// Windows release derlemesinde arkada gereksiz siyah konsol penceresi açılmasını önler
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::Command;

// 🌟 İşletim sistemine doğrudan varsayılan tarayıcıyı açtıran Rust emrimiz
#[tauri::command]
fn open_in_browser(url: String) {
    #[cfg(target_os = "windows")]
    {
        let _ = Command::new("cmd").args(["/C", "start", "", &url]).spawn();
    }
    #[cfg(target_os = "macos")]
    {
        let _ = Command::new("open").arg(&url).spawn();
    }
    #[cfg(target_os = "linux")]
    {
        let _ = Command::new("xdg-open").arg(&url).spawn();
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default().build())
        .invoke_handler(tauri::generate_handler![open_in_browser]) // 🌟 Rust emrini kaydettik
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
