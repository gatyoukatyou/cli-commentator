mod server;

use server::{server_start, server_status, server_stop, server_stop_for_shutdown, ServerState};
use tauri::Manager;
use tauri_plugin_autostart::{MacosLauncher, ManagerExt as AutoStartManagerExt};
use tauri_plugin_updater::UpdaterExt;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdaterCheckStatus {
    configured: bool,
    available: bool,
    current_version: String,
    version: Option<String>,
    date: Option<String>,
    body: Option<String>,
    error: Option<String>,
}

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

#[tauri::command]
async fn updater_check(app: tauri::AppHandle) -> UpdaterCheckStatus {
    let current_version = app.package_info().version.to_string();
    let updater = match app.updater_builder().build() {
        Ok(updater) => updater,
        Err(err) => {
            return UpdaterCheckStatus {
                configured: false,
                available: false,
                current_version,
                version: None,
                date: None,
                body: None,
                error: Some(format!("Failed to initialize updater: {}", err)),
            };
        }
    };

    match updater.check().await {
        Ok(Some(update)) => UpdaterCheckStatus {
            configured: true,
            available: true,
            current_version,
            version: Some(update.version.to_string()),
            date: update.date.map(|value| value.to_string()),
            body: update.body,
            error: None,
        },
        Ok(None) => UpdaterCheckStatus {
            configured: true,
            available: false,
            current_version,
            version: None,
            date: None,
            body: None,
            error: None,
        },
        Err(err) => UpdaterCheckStatus {
            configured: false,
            available: false,
            current_version,
            version: None,
            date: None,
            body: None,
            error: Some(format!(
                "Updater check failed. Configure updater endpoints and pubkey in tauri.conf.json. {}",
                err
            )),
        },
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(ServerState::new())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None::<Vec<&str>>,
        ))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            server_start,
            server_stop,
            server_status,
            autostart_status,
            autostart_enable,
            autostart_disable,
            updater_check
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
