use process_wrap::std::*;
use std::env;
use std::io::{Read as IoRead, Write as IoWrite};
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::State;

#[cfg(unix)]
use process_wrap::std::ProcessGroup;

#[cfg(windows)]
use process_wrap::std::JobObject;

const DEFAULT_PORT: u16 = 8787;
const HEALTH_CHECK_TIMEOUT_MS: u64 = 500;

#[derive(Debug, Clone, Copy, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ServerLifecycleState {
    Stopped,
    Starting,
    Running,
    Stopping,
    Failed,
}

#[derive(Clone, serde::Serialize)]
pub struct ServerStatus {
    pub state: ServerLifecycleState,
    pub pid: Option<u32>,
    pub started_at: Option<u64>,
    pub transitioned_at: Option<u64>,
    pub error: Option<String>,
    pub health_ok: bool,
    pub last_seen_at: Option<u64>,
    pub port: u16,
}

#[derive(Debug, Clone)]
enum ServerLifecycle {
    Stopped,
    Starting { started_at: u64 },
    Running { pid: u32, started_at: u64 },
    Stopping { started_at: u64 },
    Failed { error: String, at: u64 },
}

struct ServerRuntime {
    process: Option<Box<dyn ChildWrapper>>,
    lifecycle: ServerLifecycle,
    operation_id: u64,
    last_exit: Option<i32>,
    last_seen_at: Option<u64>,
}

pub struct ServerState {
    runtime: Arc<Mutex<ServerRuntime>>,
}

impl ServerState {
    pub fn new() -> Self {
        Self {
            runtime: Arc::new(Mutex::new(ServerRuntime {
                process: None,
                lifecycle: ServerLifecycle::Stopped,
                operation_id: 0,
                last_exit: None,
                last_seen_at: None,
            })),
        }
    }
}

/// Get server port from CLI_COMMENTATOR_PORT or PORT env var, fallback to 8787
fn get_server_port() -> u16 {
    env::var("CLI_COMMENTATOR_PORT")
        .or_else(|_| env::var("PORT"))
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(DEFAULT_PORT)
}

/// Check if the server port is in use
fn check_port_in_use(port: u16) -> bool {
    TcpStream::connect_timeout(
        &std::net::SocketAddr::from(([127, 0, 0, 1], port)),
        Duration::from_millis(200),
    )
    .is_ok()
}

/// Check server health via HTTP GET /healthz
/// Returns true if server responds with 200 OK
fn check_health(port: u16) -> bool {
    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    let timeout = Duration::from_millis(HEALTH_CHECK_TIMEOUT_MS);

    let mut stream = match TcpStream::connect_timeout(&addr, timeout) {
        Ok(s) => s,
        Err(_) => return false,
    };

    let _ = stream.set_read_timeout(Some(timeout));
    let _ = stream.set_write_timeout(Some(timeout));

    let request = format!(
        "GET /healthz HTTP/1.1\r\nHost: localhost:{}\r\nConnection: close\r\n\r\n",
        port
    );
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }

    let mut buffer = [0u8; 128];
    match stream.read(&mut buffer) {
        Ok(n) if n > 0 => {
            let response = String::from_utf8_lossy(&buffer[..n]);
            response.contains("200 OK") || response.contains("200 ")
        }
        _ => false,
    }
}

/// Get current timestamp in milliseconds
fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Get project root from CARGO_MANIFEST_DIR
/// apps/desktop/src-tauri -> cli-commentator (3 levels up)
fn get_project_root() -> Result<PathBuf, String> {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize()
        .map_err(|e| format!("Failed to get project root: {}", e))
}

fn spawn_server_process(port: u16) -> Result<Box<dyn ChildWrapper>, String> {
    let project_root = get_project_root()?;

    let mut command = CommandWrap::with_new("pnpm", |cmd| {
        cmd.args(["-C", "apps/server", "dev"])
            .current_dir(&project_root)
            .env("CLI_COMMENTATOR_PORT", port.to_string())
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit());
    });

    #[cfg(unix)]
    command.wrap(ProcessGroup::leader());

    #[cfg(windows)]
    command.wrap(JobObject);

    command
        .spawn()
        .map_err(|e| format!("Failed to start server: {}", e))
}

fn lifecycle_state(lifecycle: &ServerLifecycle) -> ServerLifecycleState {
    match lifecycle {
        ServerLifecycle::Stopped => ServerLifecycleState::Stopped,
        ServerLifecycle::Starting { .. } => ServerLifecycleState::Starting,
        ServerLifecycle::Running { .. } => ServerLifecycleState::Running,
        ServerLifecycle::Stopping { .. } => ServerLifecycleState::Stopping,
        ServerLifecycle::Failed { .. } => ServerLifecycleState::Failed,
    }
}

fn status_from_runtime(rt: &ServerRuntime, health_ok: bool, port: u16) -> ServerStatus {
    let (pid, started_at, transitioned_at, error) = match &rt.lifecycle {
        ServerLifecycle::Stopped => (None, None, None, None),
        ServerLifecycle::Starting { started_at } => (None, None, Some(*started_at), None),
        ServerLifecycle::Running { pid, started_at } => {
            (Some(*pid), Some(*started_at), Some(*started_at), None)
        }
        ServerLifecycle::Stopping { started_at } => (None, None, Some(*started_at), None),
        ServerLifecycle::Failed { error, at } => (None, None, Some(*at), Some(error.clone())),
    };

    ServerStatus {
        state: lifecycle_state(&rt.lifecycle),
        pid,
        started_at,
        transitioned_at,
        error,
        health_ok,
        last_seen_at: rt.last_seen_at,
        port,
    }
}

fn mark_failed(rt: &mut ServerRuntime, error: String) {
    rt.process = None;
    rt.lifecycle = ServerLifecycle::Failed {
        error,
        at: now_ms(),
    };
    rt.last_seen_at = None;
}

fn refresh_runtime(rt: &mut ServerRuntime, port: u16) {
    if !matches!(rt.lifecycle, ServerLifecycle::Running { .. }) {
        return;
    }

    let Some(child) = rt.process.as_mut() else {
        mark_failed(
            rt,
            "Server process handle is missing while running".to_string(),
        );
        return;
    };

    match child.try_wait() {
        Ok(Some(status)) => {
            rt.last_exit = status.code();
            let mut reason = match status.code() {
                Some(code) => format!("Server exited unexpectedly with code {}", code),
                None => "Server exited unexpectedly".to_string(),
            };
            if check_port_in_use(port) {
                reason.push_str(&format!("; port {} is already in use", port));
            }
            mark_failed(rt, reason);
        }
        Ok(None) => {}
        Err(err) => {
            mark_failed(rt, format!("Failed to read server process state: {}", err));
        }
    }
}

fn build_status(rt: &mut ServerRuntime, port: u16) -> ServerStatus {
    refresh_runtime(rt, port);

    let health_ok = if matches!(rt.lifecycle, ServerLifecycle::Running { .. }) {
        let ok = check_health(port);
        if ok {
            rt.last_seen_at = Some(now_ms());
        }
        ok
    } else {
        false
    };

    status_from_runtime(rt, health_ok, port)
}

fn start_in_background(
    runtime: Arc<Mutex<ServerRuntime>>,
    operation_id: u64,
    started_at: u64,
    port: u16,
) {
    thread::spawn(move || {
        let spawned = spawn_server_process(port);
        match spawned {
            Ok(mut child) => {
                let pid = child.id();
                let mut rt = runtime.lock().unwrap();
                if rt.operation_id != operation_id
                    || !matches!(rt.lifecycle, ServerLifecycle::Starting { .. })
                {
                    let _ = child.kill();
                    let _ = child.wait();
                    return;
                }
                rt.process = Some(child);
                rt.last_exit = None;
                rt.lifecycle = ServerLifecycle::Running { pid, started_at };
            }
            Err(error) => {
                let mut rt = runtime.lock().unwrap();
                if rt.operation_id != operation_id
                    || !matches!(rt.lifecycle, ServerLifecycle::Starting { .. })
                {
                    return;
                }
                mark_failed(&mut rt, error);
            }
        }
    });
}

fn stop_in_background(
    runtime: Arc<Mutex<ServerRuntime>>,
    operation_id: u64,
    mut child: Option<Box<dyn ChildWrapper>>,
) {
    thread::spawn(move || {
        let mut stop_error = None;
        let mut exit_code = None;

        if let Some(running_child) = child.take() {
            let (code, err) = stop_child_blocking(running_child);
            exit_code = code;
            stop_error = err;
        }

        let mut rt = runtime.lock().unwrap();
        if rt.operation_id != operation_id
            || !matches!(rt.lifecycle, ServerLifecycle::Stopping { .. })
        {
            return;
        }
        rt.process = None;
        rt.last_exit = exit_code;
        rt.last_seen_at = None;
        if let Some(error) = stop_error {
            rt.lifecycle = ServerLifecycle::Failed {
                error,
                at: now_ms(),
            };
        } else {
            rt.lifecycle = ServerLifecycle::Stopped;
        }
    });
}

fn stop_child_blocking(mut child: Box<dyn ChildWrapper>) -> (Option<i32>, Option<String>) {
    match child.try_wait() {
        Ok(Some(status)) => (status.code(), None),
        Ok(None) => {
            if let Err(err) = child.kill() {
                return (
                    None,
                    Some(format!("Failed to stop server process: {}", err)),
                );
            }
            match child.wait() {
                Ok(status) => (status.code(), None),
                Err(err) => (
                    None,
                    Some(format!("Failed to wait for server shutdown: {}", err)),
                ),
            }
        }
        Err(err) => {
            let _ = child.kill();
            let _ = child.wait();
            (
                None,
                Some(format!(
                    "Failed to inspect server process before stop: {}",
                    err
                )),
            )
        }
    }
}

#[tauri::command]
pub fn server_status(state: State<'_, ServerState>) -> Result<ServerStatus, String> {
    let port = get_server_port();
    let mut rt = state.runtime.lock().map_err(|e| e.to_string())?;
    Ok(build_status(&mut rt, port))
}

#[tauri::command]
pub fn server_start(state: State<'_, ServerState>) -> Result<ServerStatus, String> {
    let port = get_server_port();
    let runtime_arc = Arc::clone(&state.runtime);
    let mut rt = state.runtime.lock().map_err(|e| e.to_string())?;
    let current = build_status(&mut rt, port);

    if matches!(
        current.state,
        ServerLifecycleState::Starting
            | ServerLifecycleState::Running
            | ServerLifecycleState::Stopping
    ) {
        return Ok(current);
    }

    let started_at = now_ms();
    rt.operation_id += 1;
    let op_id = rt.operation_id;
    rt.lifecycle = ServerLifecycle::Starting { started_at };
    rt.last_seen_at = None;
    let response = status_from_runtime(&rt, false, port);
    drop(rt);

    start_in_background(runtime_arc, op_id, started_at, port);
    Ok(response)
}

#[tauri::command]
pub fn server_stop(state: State<'_, ServerState>) -> Result<ServerStatus, String> {
    let port = get_server_port();
    let runtime_arc = Arc::clone(&state.runtime);
    let mut rt = state.runtime.lock().map_err(|e| e.to_string())?;
    let current = build_status(&mut rt, port);

    if matches!(
        current.state,
        ServerLifecycleState::Stopped
            | ServerLifecycleState::Stopping
            | ServerLifecycleState::Failed
    ) {
        return Ok(current);
    }

    let stopping_at = now_ms();
    rt.operation_id += 1;
    let op_id = rt.operation_id;
    rt.lifecycle = ServerLifecycle::Stopping {
        started_at: stopping_at,
    };
    rt.last_seen_at = None;
    let child = rt.process.take();
    let response = status_from_runtime(&rt, false, port);
    drop(rt);

    stop_in_background(runtime_arc, op_id, child);
    Ok(response)
}

pub fn server_stop_for_shutdown(state: State<'_, ServerState>) -> Result<(), String> {
    let mut rt = state.runtime.lock().map_err(|e| e.to_string())?;
    rt.operation_id += 1;
    rt.last_seen_at = None;
    rt.lifecycle = ServerLifecycle::Stopping {
        started_at: now_ms(),
    };
    if let Some(running_child) = rt.process.take() {
        let (exit_code, stop_error) = stop_child_blocking(running_child);
        rt.last_exit = exit_code;
        if let Some(error) = stop_error {
            rt.lifecycle = ServerLifecycle::Failed {
                error: error.clone(),
                at: now_ms(),
            };
            return Err(error);
        }
    }
    rt.process = None;
    rt.lifecycle = ServerLifecycle::Stopped;
    rt.last_seen_at = None;
    Ok(())
}
