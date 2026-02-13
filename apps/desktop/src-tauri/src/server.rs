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

fn format_failure(
    category: &'static str,
    summary: &'static str,
    context: &[(&'static str, String)],
) -> String {
    let mut message = format!("[{}] {}", category, summary);
    for (key, value) in context {
        if !value.is_empty() {
            message.push_str(&format!(" | {}={}", key, value));
        }
    }
    message
}

/// Get project root from CARGO_MANIFEST_DIR
/// apps/desktop/src-tauri -> cli-commentator (3 levels up)
fn get_project_root() -> Result<PathBuf, String> {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize()
        .map_err(|e| {
            format_failure(
                "project_root",
                "Failed to get project root",
                &[("error", e.to_string())],
            )
        })
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
        .map_err(|e| {
            format_failure(
                "spawn",
                "Failed to start server",
                &[("error", e.to_string()), ("port", port.to_string())],
            )
        })
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

#[derive(serde::Serialize)]
struct LifecycleEventLog {
    ts: u64,
    trigger: &'static str,
    from: ServerLifecycleState,
    to: ServerLifecycleState,
    operation_id: u64,
    pid: Option<u32>,
    port: Option<u16>,
    detail: Option<String>,
}

fn lifecycle_pid(lifecycle: &ServerLifecycle) -> Option<u32> {
    match lifecycle {
        ServerLifecycle::Running { pid, .. } => Some(*pid),
        _ => None,
    }
}

fn emit_lifecycle_event(
    trigger: &'static str,
    from: &ServerLifecycle,
    to: &ServerLifecycle,
    operation_id: u64,
    port: Option<u16>,
    detail: Option<String>,
) {
    let payload = LifecycleEventLog {
        ts: now_ms(),
        trigger,
        from: lifecycle_state(from),
        to: lifecycle_state(to),
        operation_id,
        pid: lifecycle_pid(to).or_else(|| lifecycle_pid(from)),
        port,
        detail,
    };

    match serde_json::to_string(&payload) {
        Ok(json) => eprintln!("[desktop/server-event] {}", json),
        Err(error) => eprintln!(
            "[desktop/server-event] {{\"trigger\":\"{}\",\"error\":\"serialize_failed:{}\"}}",
            trigger, error
        ),
    }
}

fn set_lifecycle(
    rt: &mut ServerRuntime,
    next: ServerLifecycle,
    trigger: &'static str,
    port: Option<u16>,
    detail: Option<String>,
) {
    let previous = rt.lifecycle.clone();
    rt.lifecycle = next;
    emit_lifecycle_event(trigger, &previous, &rt.lifecycle, rt.operation_id, port, detail);
}

fn mark_failed(rt: &mut ServerRuntime, error: String, trigger: &'static str, port: Option<u16>) {
    eprintln!("[desktop/server] lifecycle=failed {}", error);
    rt.process = None;
    set_lifecycle(
        rt,
        ServerLifecycle::Failed {
            error: error.clone(),
            at: now_ms(),
        },
        trigger,
        port,
        Some(error),
    );
    rt.last_seen_at = None;
}

fn refresh_runtime(rt: &mut ServerRuntime, port: u16) {
    if !matches!(rt.lifecycle, ServerLifecycle::Running { .. }) {
        return;
    }

    let Some(child) = rt.process.as_mut() else {
        mark_failed(
            rt,
            format_failure(
                "missing_process_handle",
                "Server process handle is missing while running",
                &[("port", port.to_string())],
            ),
            "refresh_runtime_missing_handle",
            Some(port),
        );
        return;
    };

    match child.try_wait() {
        Ok(Some(status)) => {
            rt.last_exit = status.code();
            let exit_code = status
                .code()
                .map(|code| code.to_string())
                .unwrap_or_else(|| "signal_or_unknown".to_string());
            let port_in_use = check_port_in_use(port);
            mark_failed(
                rt,
                format_failure(
                    "unexpected_exit",
                    "Server exited unexpectedly",
                    &[
                        ("exit_code", exit_code),
                        ("port", port.to_string()),
                        ("port_in_use", port_in_use.to_string()),
                    ],
                ),
                "refresh_runtime_unexpected_exit",
                Some(port),
            );
        }
        Ok(None) => {}
        Err(err) => {
            mark_failed(
                rt,
                format_failure(
                    "process_state",
                    "Failed to read server process state",
                    &[("error", err.to_string())],
                ),
                "refresh_runtime_process_state_error",
                Some(port),
            );
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
                set_lifecycle(
                    &mut rt,
                    ServerLifecycle::Running { pid, started_at },
                    "spawn_server_success",
                    Some(port),
                    Some(format!("pid={}", pid)),
                );
            }
            Err(error) => {
                let mut rt = runtime.lock().unwrap();
                if rt.operation_id != operation_id
                    || !matches!(rt.lifecycle, ServerLifecycle::Starting { .. })
                {
                    return;
                }
                mark_failed(&mut rt, error, "spawn_server_failed", Some(port));
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
            mark_failed(&mut rt, error, "stop_in_background_failed", None);
        } else {
            set_lifecycle(
                &mut rt,
                ServerLifecycle::Stopped,
                "stop_in_background_success",
                None,
                Some(format!(
                    "exit_code={}",
                    exit_code
                        .map(|code| code.to_string())
                        .unwrap_or_else(|| "none".to_string())
                )),
            );
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
                    Some(format_failure(
                        "stop_process",
                        "Failed to stop server process",
                        &[("error", err.to_string())],
                    )),
                );
            }
            match child.wait() {
                Ok(status) => (status.code(), None),
                Err(err) => (
                    None,
                    Some(format_failure(
                        "wait_shutdown",
                        "Failed to wait for server shutdown",
                        &[("error", err.to_string())],
                    )),
                ),
            }
        }
        Err(err) => {
            let _ = child.kill();
            let _ = child.wait();
            (
                None,
                Some(format_failure(
                    "inspect_before_stop",
                    "Failed to inspect server process before stop",
                    &[("error", err.to_string())],
                )),
            )
        }
    }
}

enum StartAction {
    Noop(ServerStatus),
    Start {
        operation_id: u64,
        started_at: u64,
        status: ServerStatus,
    },
}

fn begin_start_transition(rt: &mut ServerRuntime, port: u16) -> StartAction {
    let current = build_status(rt, port);
    if matches!(
        current.state,
        ServerLifecycleState::Starting
            | ServerLifecycleState::Running
            | ServerLifecycleState::Stopping
    ) {
        return StartAction::Noop(current);
    }

    let started_at = now_ms();
    rt.operation_id += 1;
    let operation_id = rt.operation_id;
    set_lifecycle(
        rt,
        ServerLifecycle::Starting { started_at },
        "begin_start_transition",
        Some(port),
        None,
    );
    rt.last_seen_at = None;
    StartAction::Start {
        operation_id,
        started_at,
        status: status_from_runtime(rt, false, port),
    }
}

enum StopAction {
    Noop(ServerStatus),
    Stop {
        operation_id: u64,
        child: Option<Box<dyn ChildWrapper>>,
        status: ServerStatus,
    },
}

fn begin_stop_transition(rt: &mut ServerRuntime, port: u16) -> StopAction {
    let current = build_status(rt, port);
    if matches!(
        current.state,
        ServerLifecycleState::Stopped
            | ServerLifecycleState::Stopping
            | ServerLifecycleState::Failed
    ) {
        return StopAction::Noop(current);
    }

    rt.operation_id += 1;
    let operation_id = rt.operation_id;
    set_lifecycle(
        rt,
        ServerLifecycle::Stopping {
            started_at: now_ms(),
        },
        "begin_stop_transition",
        Some(port),
        None,
    );
    rt.last_seen_at = None;
    let child = rt.process.take();
    StopAction::Stop {
        operation_id,
        child,
        status: status_from_runtime(rt, false, port),
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
    match begin_start_transition(&mut rt, port) {
        StartAction::Noop(status) => Ok(status),
        StartAction::Start {
            operation_id,
            started_at,
            status,
        } => {
            drop(rt);
            start_in_background(runtime_arc, operation_id, started_at, port);
            Ok(status)
        }
    }
}

#[tauri::command]
pub fn server_stop(state: State<'_, ServerState>) -> Result<ServerStatus, String> {
    let port = get_server_port();
    let runtime_arc = Arc::clone(&state.runtime);
    let mut rt = state.runtime.lock().map_err(|e| e.to_string())?;
    match begin_stop_transition(&mut rt, port) {
        StopAction::Noop(status) => Ok(status),
        StopAction::Stop {
            operation_id,
            child,
            status,
        } => {
            drop(rt);
            stop_in_background(runtime_arc, operation_id, child);
            Ok(status)
        }
    }
}

pub fn server_stop_for_shutdown(state: State<'_, ServerState>) -> Result<(), String> {
    let port = get_server_port();
    let mut rt = state.runtime.lock().map_err(|e| e.to_string())?;
    rt.operation_id += 1;
    rt.last_seen_at = None;
    set_lifecycle(
        &mut rt,
        ServerLifecycle::Stopping {
            started_at: now_ms(),
        },
        "server_stop_for_shutdown_begin",
        Some(port),
        None,
    );
    if let Some(running_child) = rt.process.take() {
        let (exit_code, stop_error) = stop_child_blocking(running_child);
        rt.last_exit = exit_code;
        if let Some(error) = stop_error {
            mark_failed(&mut rt, error.clone(), "server_stop_for_shutdown_failed", Some(port));
            return Err(error);
        }
    }
    rt.process = None;
    set_lifecycle(
        &mut rt,
        ServerLifecycle::Stopped,
        "server_stop_for_shutdown_success",
        Some(port),
        None,
    );
    rt.last_seen_at = None;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Result as IoResult;
    use std::process::{ChildStderr, ChildStdin, ChildStdout, ExitStatus};

    #[derive(Debug)]
    struct MockChild {
        pid: u32,
        exited: bool,
        stdin: Option<ChildStdin>,
        stdout: Option<ChildStdout>,
        stderr: Option<ChildStderr>,
    }

    impl MockChild {
        fn new(pid: u32) -> Self {
            Self {
                pid,
                exited: false,
                stdin: None,
                stdout: None,
                stderr: None,
            }
        }
    }

    #[cfg(unix)]
    fn success_status() -> ExitStatus {
        use std::os::unix::process::ExitStatusExt;
        ExitStatus::from_raw(0)
    }

    #[cfg(windows)]
    fn success_status() -> ExitStatus {
        use std::os::windows::process::ExitStatusExt;
        ExitStatus::from_raw(0)
    }

    impl ChildWrapper for MockChild {
        fn inner(&self) -> &dyn ChildWrapper {
            self
        }

        fn inner_mut(&mut self) -> &mut dyn ChildWrapper {
            self
        }

        fn into_inner(self: Box<Self>) -> Box<dyn ChildWrapper> {
            self
        }

        fn stdin(&mut self) -> &mut Option<ChildStdin> {
            &mut self.stdin
        }

        fn stdout(&mut self) -> &mut Option<ChildStdout> {
            &mut self.stdout
        }

        fn stderr(&mut self) -> &mut Option<ChildStderr> {
            &mut self.stderr
        }

        fn id(&self) -> u32 {
            self.pid
        }

        fn kill(&mut self) -> IoResult<()> {
            self.exited = true;
            Ok(())
        }

        fn start_kill(&mut self) -> IoResult<()> {
            self.exited = true;
            Ok(())
        }

        fn try_wait(&mut self) -> IoResult<Option<ExitStatus>> {
            if self.exited {
                Ok(Some(success_status()))
            } else {
                Ok(None)
            }
        }

        fn wait(&mut self) -> IoResult<ExitStatus> {
            self.exited = true;
            Ok(success_status())
        }
    }

    fn runtime_with(lifecycle: ServerLifecycle) -> ServerRuntime {
        ServerRuntime {
            process: None,
            lifecycle,
            operation_id: 0,
            last_exit: None,
            last_seen_at: None,
        }
    }

    fn runtime_with_running_child() -> ServerRuntime {
        ServerRuntime {
            process: Some(Box::new(MockChild::new(1234))),
            lifecycle: ServerLifecycle::Running {
                pid: 1234,
                started_at: now_ms(),
            },
            operation_id: 0,
            last_exit: None,
            last_seen_at: None,
        }
    }

    fn runtime_with_exited_child() -> ServerRuntime {
        let mut child = MockChild::new(5678);
        child.exited = true;
        ServerRuntime {
            process: Some(Box::new(child)),
            lifecycle: ServerLifecycle::Running {
                pid: 5678,
                started_at: now_ms(),
            },
            operation_id: 0,
            last_exit: None,
            last_seen_at: None,
        }
    }

    #[test]
    fn start_transition_is_idempotent_while_starting() {
        let port = 8787;
        let mut rt = runtime_with(ServerLifecycle::Stopped);
        let first = begin_start_transition(&mut rt, port);
        match first {
            StartAction::Start { status, .. } => {
                assert_eq!(status.state, ServerLifecycleState::Starting);
            }
            StartAction::Noop(_) => panic!("first start should transition to starting"),
        }

        let second = begin_start_transition(&mut rt, port);
        match second {
            StartAction::Noop(status) => {
                assert_eq!(status.state, ServerLifecycleState::Starting);
            }
            StartAction::Start { .. } => panic!("second start should be no-op"),
        }
    }

    #[test]
    fn failed_state_can_retry_start() {
        let port = 8787;
        let mut rt = runtime_with(ServerLifecycle::Failed {
            error: "spawn failed".to_string(),
            at: now_ms(),
        });

        let next = begin_start_transition(&mut rt, port);
        match next {
            StartAction::Start { status, .. } => {
                assert_eq!(status.state, ServerLifecycleState::Starting);
                assert_eq!(status.error, None);
            }
            StartAction::Noop(_) => panic!("failed state should allow retry"),
        }
    }

    #[test]
    fn stop_transition_is_idempotent_outside_running() {
        let port = 8787;
        let mut stopped = runtime_with(ServerLifecycle::Stopped);
        let noop = begin_stop_transition(&mut stopped, port);
        match noop {
            StopAction::Noop(status) => assert_eq!(status.state, ServerLifecycleState::Stopped),
            StopAction::Stop { .. } => panic!("stopped should remain noop"),
        }

        let mut failed = runtime_with(ServerLifecycle::Failed {
            error: "boom".to_string(),
            at: now_ms(),
        });
        let noop_failed = begin_stop_transition(&mut failed, port);
        match noop_failed {
            StopAction::Noop(status) => assert_eq!(status.state, ServerLifecycleState::Failed),
            StopAction::Stop { .. } => panic!("failed should remain noop"),
        }
    }

    #[test]
    fn stop_transition_moves_running_to_stopping_once() {
        let port = 8787;
        let mut rt = runtime_with_running_child();

        let first = begin_stop_transition(&mut rt, port);
        match first {
            StopAction::Stop { status, child, .. } => {
                assert_eq!(status.state, ServerLifecycleState::Stopping);
                assert!(child.is_some());
            }
            StopAction::Noop(_) => panic!("running should transition to stopping"),
        }

        let second = begin_stop_transition(&mut rt, port);
        match second {
            StopAction::Noop(status) => {
                assert_eq!(status.state, ServerLifecycleState::Stopping);
            }
            StopAction::Stop { .. } => panic!("second stop should be noop"),
        }
    }

    #[test]
    fn running_without_child_handle_falls_back_to_failed() {
        let port = 8787;
        let mut rt = runtime_with(ServerLifecycle::Running {
            pid: 9999,
            started_at: now_ms(),
        });

        let status = build_status(&mut rt, port);
        assert_eq!(status.state, ServerLifecycleState::Failed);
        assert!(status
            .error
            .as_deref()
            .unwrap_or("")
            .contains("handle is missing"));
    }

    #[test]
    fn unexpected_exit_error_is_categorized_with_context() {
        let port = 8787;
        let mut rt = runtime_with_exited_child();

        let status = build_status(&mut rt, port);
        assert_eq!(status.state, ServerLifecycleState::Failed);
        let error = status.error.unwrap_or_default();
        assert!(error.contains("[unexpected_exit]"));
        assert!(error.contains("exit_code="));
        assert!(error.contains("port="));
        assert!(error.contains("port_in_use="));
    }
}
