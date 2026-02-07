mod server;

use server::{server_start, server_status, server_stop, server_stop_for_shutdown, ServerState};
use tauri::Manager;
use tauri_plugin_autostart::{MacosLauncher, ManagerExt as AutoStartManagerExt};

#[tauri::command]
fn autostart_status(app: tauri::AppHandle) -> Result<bool, String> {
    app.autolaunch()
        .is_enabled()
        .map_err(|e| format!("Failed to read autostart status: {}", e))
}

#[tauri::command]
fn autostart_enable(app: tauri::AppHandle) -> Result<bool, String> {
    app.autolaunch()
        .enable()
        .map_err(|e| format!("Failed to enable autostart: {}", e))?;
    app.autolaunch()
        .is_enabled()
        .map_err(|e| format!("Failed to verify autostart status: {}", e))
}

#[tauri::command]
fn autostart_disable(app: tauri::AppHandle) -> Result<bool, String> {
    app.autolaunch()
        .disable()
        .map_err(|e| format!("Failed to disable autostart: {}", e))?;
    app.autolaunch()
        .is_enabled()
        .map_err(|e| format!("Failed to verify autostart status: {}", e))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(ServerState::new())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None::<Vec<&str>>,
        ))
        .invoke_handler(tauri::generate_handler![
            server_start,
            server_stop,
            server_status,
            autostart_status,
            autostart_enable,
            autostart_disable
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                if let Some(state) = window.try_state::<ServerState>() {
                    let _ = server_stop_for_shutdown(state);
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
