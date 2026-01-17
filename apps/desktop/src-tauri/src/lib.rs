mod server;

use server::{server_status, start_server, stop_server, ServerState};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(ServerState::new())
        .invoke_handler(tauri::generate_handler![
            start_server,
            stop_server,
            server_status
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                if let Some(state) = window.try_state::<ServerState>() {
                    let _ = stop_server(state);
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
