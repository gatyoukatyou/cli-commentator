mod server;

use server::{server_start, server_status, server_stop, server_stop_for_shutdown, ServerState};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(ServerState::new())
        .invoke_handler(tauri::generate_handler![
            server_start,
            server_stop,
            server_status
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
