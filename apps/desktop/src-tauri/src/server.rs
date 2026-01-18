use std::env;
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::State;
use process_wrap::std::*;

#[cfg(unix)]
use process_wrap::std::ProcessGroup;

#[cfg(windows)]
use process_wrap::std::JobObject;

const DEFAULT_PORT: u16 = 8787;

/// Get server port from CLI_COMMENTATOR_PORT or PORT env var, fallback to 8787
fn get_server_port() -> u16 {
    env::var("CLI_COMMENTATOR_PORT")
        .or_else(|_| env::var("PORT"))
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(DEFAULT_PORT)
}

#[derive(Clone, serde::Serialize)]
pub struct ServerStatus {
    pub desired: DesiredState,
    pub actual: ActualState,
    pub pid: Option<u32>,
    pub started_at: Option<u64>,
    pub exit_code: Option<i32>,
    pub crash_suspected: bool,
    pub orphan_suspected: bool,
    pub diagnostics: Option<String>,
}

#[derive(Debug, Clone, Copy, serde::Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum DesiredState {
    Running,
    Stopped,
}

#[derive(Debug, Clone, Copy, serde::Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ActualState {
    Alive,
    Dead,
    Unknown,
}

struct ServerRuntime {
    process: Option<Box<dyn ChildWrapper>>,
    desired: DesiredState,
    pid: Option<u32>,
    started_at: Option<u64>,
    last_exit: Option<i32>,
}

pub struct ServerState {
    runtime: Mutex<ServerRuntime>,
}

impl ServerState {
    pub fn new() -> Self {
        Self {
            runtime: Mutex::new(ServerRuntime {
                process: None,
                desired: DesiredState::Stopped,
                pid: None,
                started_at: None,
                last_exit: None,
            }),
        }
    }
}

/// Check if the server port is in use
fn check_port_in_use(port: u16) -> bool {
    TcpStream::connect_timeout(
        &std::net::SocketAddr::from(([127, 0, 0, 1], port)),
        Duration::from_millis(200),
    )
    .is_ok()
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
pub fn server_status_detailed(state: State<'_, ServerState>) -> ServerStatus {
    let mut rt = state.runtime.lock().unwrap();
    let port = get_server_port();

    // 1. Check process liveness + cleanup if dead
    let (actual, exit_code) = match rt.process.as_mut() {
        Some(child) => match child.try_wait() {
            Ok(Some(status)) => {
                // Process exited → cleanup
                rt.last_exit = status.code();
                rt.process = None; // Release handle
                (ActualState::Dead, rt.last_exit)
            }
            Ok(None) => (ActualState::Alive, None),
            Err(_) => (ActualState::Unknown, None),
        },
        None => (ActualState::Dead, rt.last_exit),
    };

    // 2. Crash detection (desired=running but actual=dead)
    let crash_suspected = rt.desired == DesiredState::Running && actual == ActualState::Dead;

    // 3. Orphan detection (port in use but no tracked process)
    let orphan_suspected = rt.process.is_none() && check_port_in_use(port);

    // 4. Log warnings
    if crash_suspected {
        eprintln!(
            "[WARN] Crash suspected: desired={:?}, actual={:?}, pid={:?}",
            rt.desired, actual, rt.pid
        );
    }
    if orphan_suspected {
        eprintln!(
            "[WARN] Orphan suspected: port {} in use but no tracked process",
            port
        );
    }

    // 5. Generate diagnostics
    let diagnostics = match (crash_suspected, orphan_suspected) {
        (true, true) => Some("crash_and_orphan".to_string()),
        (true, false) => Some("crash_suspected".to_string()),
        (false, true) => Some("orphan_port_in_use".to_string()),
        (false, false) => None,
    };

    ServerStatus {
        desired: rt.desired,
        actual,
        pid: rt.pid,
        started_at: rt.started_at,
        exit_code,
        crash_suspected,
        orphan_suspected,
        diagnostics,
    }
}

#[tauri::command]
pub fn server_status(state: State<'_, ServerState>) -> bool {
    let status = server_status_detailed(state);
    status.actual == ActualState::Alive
}

#[tauri::command]
pub fn start_server(state: State<'_, ServerState>) -> Result<bool, String> {
    let mut rt = state.runtime.lock().map_err(|e| e.to_string())?;

    // Cleanup dead handle if exists
    if let Some(ref mut child) = rt.process {
        if let Ok(Some(status)) = child.try_wait() {
            rt.last_exit = status.code();
            rt.process = None;
        }
    }

    // Already alive → return false
    if rt.process.is_some() {
        return Ok(false);
    }

    let project_root = get_project_root()?;
    let port = get_server_port();

    let mut command = CommandWrap::with_new("pnpm", |cmd| {
        cmd.args(["-C", "apps/server", "dev"])
            .current_dir(&project_root)
            .env("CLI_COMMENTATOR_PORT", port.to_string())
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit());
    });

    // Platform-specific wrapper for proper child process cleanup
    #[cfg(unix)]
    command.wrap(ProcessGroup::leader());

    #[cfg(windows)]
    command.wrap(JobObject);

    let child = command
        .spawn()
        .map_err(|e| format!("Failed to start server: {}", e))?;

    let pid = child.id();
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    rt.process = Some(child);
    rt.desired = DesiredState::Running;
    rt.pid = Some(pid);
    rt.started_at = Some(now);

    Ok(true)
}

#[tauri::command]
pub fn stop_server(state: State<'_, ServerState>) -> Result<(), String> {
    let mut rt = state.runtime.lock().map_err(|e| e.to_string())?;

    rt.desired = DesiredState::Stopped;

    if let Some(mut child) = rt.process.take() {
        // Try to get exit code before kill
        if let Ok(Some(status)) = child.try_wait() {
            rt.last_exit = status.code();
        } else {
            // kill() terminates the entire process group (Unix) or job object (Windows)
            let _ = child.kill();
            // Get exit code after kill
            if let Ok(status) = child.wait() {
                rt.last_exit = status.code();
            }
        }
    }

    // Clear stale tracking info on intentional stop
    rt.pid = None;
    rt.started_at = None;

    Ok(())
}
