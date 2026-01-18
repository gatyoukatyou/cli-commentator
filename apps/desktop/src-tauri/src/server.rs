use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::State;

pub struct ServerState {
    process: Mutex<Option<Child>>,
}

impl ServerState {
    pub fn new() -> Self {
        Self {
            process: Mutex::new(None),
        }
    }
}

/// Get project root from CARGO_MANIFEST_DIR
/// apps/desktop/src-tauri -> cli-commentator (3 levels up)
fn get_project_root() -> Result<PathBuf, String> {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize()
        .map_err(|e| format!("Failed to get project root: {}", e))
}

#[tauri::command]
pub fn start_server(state: State<'_, ServerState>) -> Result<bool, String> {
    let mut proc = state.process.lock().map_err(|e| e.to_string())?;

    if proc.is_some() {
        return Ok(false); // Already running
    }

    let project_root = get_project_root()?;

    let child = Command::new("pnpm")
        .args(["-C", "apps/server", "dev"])
        .current_dir(&project_root)
        .stdout(Stdio::inherit()) // Inherit logs to avoid buffer issues
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|e| format!("Failed to start server: {}", e))?;

    *proc = Some(child);
    Ok(true)
}

#[tauri::command]
pub fn stop_server(state: State<'_, ServerState>) -> Result<(), String> {
    let mut proc = state.process.lock().map_err(|e| e.to_string())?;

    if let Some(mut child) = proc.take() {
        let pid = child.id();

        // Kill the process group to also terminate child processes (node, etc.)
        #[cfg(unix)]
        {
            use std::process::Command as StdCommand;
            // Use pkill to kill all child processes of the pnpm process
            let _ = StdCommand::new("pkill")
                .args(["-P", &pid.to_string()])
                .status();
        }

        // Then kill the main process
        let _ = child.kill();
        let _ = child.wait(); // Reap the zombie process
    }

    Ok(())
}

#[tauri::command]
pub fn server_status(state: State<'_, ServerState>) -> bool {
    state
        .process
        .lock()
        .map(|p| p.is_some())
        .unwrap_or(false)
}
