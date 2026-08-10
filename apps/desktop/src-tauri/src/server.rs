use process_wrap::std::*;
use std::env;
use std::fs;
use std::io::{Read as IoRead, Write as IoWrite};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::path::BaseDirectory;
use tauri::{Manager, State};

#[cfg(unix)]
use process_wrap::std::ProcessGroup;

#[cfg(windows)]
use process_wrap::std::JobObject;

const DEFAULT_PORT: u16 = 8787;
const MANAGED_SERVER_ENV: &str = "CLI_COMMENTATOR_MANAGED_SERVER";
const HEALTH_CHECK_TIMEOUT_MS: u64 = 500;
const PORT_SCAN_ATTEMPTS: u16 = 64;

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SidecarManifest {
    node_binary: String,
    server_entry: String,
    server_root: String,
}

struct SidecarRuntimePaths {
    manifest_path: PathBuf,
    sidecar_root: PathBuf,
    node_binary_path: PathBuf,
    server_entry_path: PathBuf,
    server_working_dir: PathBuf,
}

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
    selected_port: u16,
    operation_id: u64,
    last_exit: Option<i32>,
    last_seen_at: Option<u64>,
}

pub struct ServerState {
    runtime: Arc<Mutex<ServerRuntime>>,
}

impl ServerState {
    pub fn new() -> Self {
        let configured_port = get_configured_server_port();
        Self {
            runtime: Arc::new(Mutex::new(ServerRuntime {
                process: None,
                lifecycle: ServerLifecycle::Stopped,
                selected_port: configured_port,
                operation_id: 0,
                last_exit: None,
                last_seen_at: None,
            })),
        }
    }
}

/// Read preferred server port from env (fallback: 8787)
fn get_configured_server_port() -> u16 {
    env::var("CLI_COMMENTATOR_PORT")
        .or_else(|_| env::var("PORT"))
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(DEFAULT_PORT)
}

fn choose_available_port(preferred_port: u16) -> Result<u16, String> {
    if !check_port_in_use(preferred_port) {
        return Ok(preferred_port);
    }

    for step in 1..=PORT_SCAN_ATTEMPTS {
        let candidate_port = preferred_port as u32 + step as u32;
        if candidate_port > u16::MAX as u32 {
            break;
        }
        let candidate_port = candidate_port as u16;
        if !check_port_in_use(candidate_port) {
            return Ok(candidate_port);
        }
    }

    Err(format_failure(
        "port_resolve",
        "No available server port was found",
        &[
            ("preferred", preferred_port.to_string()),
            ("attempts", PORT_SCAN_ATTEMPTS.to_string()),
        ],
    ))
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

fn sidecar_root_from_manifest(manifest_path: &PathBuf) -> Result<PathBuf, String> {
    let manifest_dir = manifest_path.parent().ok_or_else(|| {
        format_failure(
            "sidecar_manifest_parent",
            "Failed to resolve sidecar manifest parent directory",
            &[("manifest", manifest_path.display().to_string())],
        )
    })?;

    let root = match manifest_dir.file_name().and_then(|name| name.to_str()) {
        Some("resources") => manifest_dir.parent().unwrap_or(manifest_dir).to_path_buf(),
        _ => manifest_dir.to_path_buf(),
    };

    Ok(root)
}

fn push_unique_path(candidates: &mut Vec<PathBuf>, candidate: PathBuf) {
    if !candidates.iter().any(|path| path == &candidate) {
        candidates.push(candidate);
    }
}

fn stringify_paths(paths: &[PathBuf]) -> String {
    paths
        .iter()
        .map(|path| path.display().to_string())
        .collect::<Vec<_>>()
        .join(",")
}

fn format_sidecar_node_missing_failure(
    manifest_path: &Path,
    sidecar_root: &Path,
    expected: &Path,
    candidates: &[PathBuf],
    executable_dir: Option<&PathBuf>,
) -> String {
    format_failure(
        "sidecar_node_missing",
        "Bundled node binary is missing",
        &[
            ("manifest", manifest_path.display().to_string()),
            ("sidecar_root", sidecar_root.display().to_string()),
            ("node_binary", expected.display().to_string()),
            ("candidates", stringify_paths(candidates)),
            (
                "executable_dir",
                executable_dir
                    .map(|path| path.display().to_string())
                    .unwrap_or_default(),
            ),
        ],
    )
}

fn format_sidecar_server_entry_missing_failure(
    manifest_path: &Path,
    sidecar_root: &Path,
    server_entry_path: &Path,
) -> String {
    format_failure(
        "sidecar_server_entry_missing",
        "Bundled server entry is missing",
        &[
            ("manifest", manifest_path.display().to_string()),
            ("sidecar_root", sidecar_root.display().to_string()),
            ("server_entry", server_entry_path.display().to_string()),
        ],
    )
}

fn format_sidecar_server_root_missing_failure(
    manifest_path: &Path,
    sidecar_root: &Path,
    server_root_path: &Path,
) -> String {
    format_failure(
        "sidecar_server_root_missing",
        "Bundled server root is missing",
        &[
            ("manifest", manifest_path.display().to_string()),
            ("sidecar_root", sidecar_root.display().to_string()),
            ("server_root", server_root_path.display().to_string()),
        ],
    )
}

fn resolve_node_binary_path(
    sidecar_root: &PathBuf,
    manifest_node_binary: &str,
    executable_dir: Option<&PathBuf>,
) -> Result<PathBuf, Vec<PathBuf>> {
    let mut candidates = Vec::new();
    push_unique_path(
        &mut candidates,
        sidecar_root.join(manifest_node_binary),
    );

    if let Some(exe_dir) = executable_dir {
        if let Some(name) = PathBuf::from(manifest_node_binary).file_name() {
            push_unique_path(&mut candidates, exe_dir.join(name));
        }
        #[cfg(windows)]
        push_unique_path(&mut candidates, exe_dir.join("node.exe"));
        #[cfg(not(windows))]
        push_unique_path(&mut candidates, exe_dir.join("node"));
    }

    candidates
        .iter()
        .find(|path| path.is_file())
        .cloned()
        .ok_or(candidates)
}

fn resolve_sidecar_runtime_paths(app: &tauri::AppHandle) -> Result<SidecarRuntimePaths, String> {
    let mut manifest_candidates = Vec::new();
    if let Ok(path) = app
        .path()
        .resolve("resources/sidecar-manifest.json", BaseDirectory::Resource)
    {
        manifest_candidates.push(path);
    }
    if let Ok(path) = app
        .path()
        .resolve("sidecar-manifest.json", BaseDirectory::Resource)
    {
        if !manifest_candidates
            .iter()
            .any(|candidate| candidate == &path)
        {
            manifest_candidates.push(path);
        }
    }

    let dev_manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("sidecar-manifest.json");
    if !manifest_candidates
        .iter()
        .any(|candidate| candidate == &dev_manifest)
    {
        manifest_candidates.push(dev_manifest);
    }

    let manifest_path = manifest_candidates
        .iter()
        .find(|path| path.exists())
        .cloned()
        .ok_or_else(|| {
            format_failure(
                "sidecar_manifest_missing",
                "No sidecar manifest was found",
                &[(
                    "candidates",
                    manifest_candidates
                        .iter()
                        .map(|path| path.display().to_string())
                        .collect::<Vec<_>>()
                        .join(","),
                )],
            )
        })?;

    let raw_manifest = fs::read_to_string(&manifest_path).map_err(|error| {
        format_failure(
            "sidecar_manifest_read",
            "Failed to read sidecar manifest",
            &[
                ("manifest", manifest_path.display().to_string()),
                ("error", error.to_string()),
            ],
        )
    })?;

    let manifest: SidecarManifest = serde_json::from_str(&raw_manifest).map_err(|error| {
        format_failure(
            "sidecar_manifest_parse",
            "Failed to parse sidecar manifest",
            &[
                ("manifest", manifest_path.display().to_string()),
                ("error", error.to_string()),
            ],
        )
    })?;

    let sidecar_root = sidecar_root_from_manifest(&manifest_path)?;
    let executable_dir = env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(|parent| parent.to_path_buf()));
    let node_binary_path = match resolve_node_binary_path(
        &sidecar_root,
        &manifest.node_binary,
        executable_dir.as_ref(),
    ) {
        Ok(path) => path,
        Err(candidates) => {
            let expected = sidecar_root.join(&manifest.node_binary);
            return Err(format_sidecar_node_missing_failure(
                &manifest_path,
                &sidecar_root,
                &expected,
                &candidates,
                executable_dir.as_ref(),
            ));
        }
    };
    if !node_binary_path.exists() {
        return Err(format_sidecar_node_missing_failure(
            &manifest_path,
            &sidecar_root,
            &node_binary_path,
            &[],
            executable_dir.as_ref(),
        ));
    }

    let server_entry_path = sidecar_root.join(&manifest.server_entry);
    if !server_entry_path.exists() {
        return Err(format_sidecar_server_entry_missing_failure(
            &manifest_path,
            &sidecar_root,
            &server_entry_path,
        ));
    }

    let server_working_dir = sidecar_root.join(&manifest.server_root);
    if !server_working_dir.exists() {
        return Err(format_sidecar_server_root_missing_failure(
            &manifest_path,
            &sidecar_root,
            &server_working_dir,
        ));
    }

    Ok(SidecarRuntimePaths {
        manifest_path,
        sidecar_root,
        node_binary_path,
        server_entry_path,
        server_working_dir,
    })
}

fn spawn_server_process(
    app: &tauri::AppHandle,
    port: u16,
) -> Result<Box<dyn ChildWrapper>, String> {
    let sidecar_paths = resolve_sidecar_runtime_paths(app)?;
    let manifest_for_error = sidecar_paths.manifest_path.display().to_string();
    let sidecar_root_for_error = sidecar_paths.sidecar_root.display().to_string();
    let node_binary = sidecar_paths.node_binary_path;
    let server_entry = sidecar_paths.server_entry_path;
    let server_working_dir = sidecar_paths.server_working_dir;
    let node_for_error = node_binary.display().to_string();
    let entry_for_error = server_entry.display().to_string();
    let cwd_for_error = server_working_dir.display().to_string();

    let mut command = CommandWrap::with_new(&node_binary, |cmd| {
        cmd.arg(&server_entry)
            .current_dir(&server_working_dir)
            .env("CLI_COMMENTATOR_PORT", port.to_string())
            .env(MANAGED_SERVER_ENV, "1")
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit());
    });

    #[cfg(unix)]
    command.wrap(ProcessGroup::leader());

    #[cfg(windows)]
    command.wrap(JobObject);

    command.spawn().map_err(|e| {
        format_failure(
            "spawn",
            "Failed to start server",
            &[
                ("error", e.to_string()),
                ("port", port.to_string()),
                ("manifest", manifest_for_error),
                ("sidecar_root", sidecar_root_for_error),
                ("node", node_for_error),
                ("entry", entry_for_error),
                ("cwd", cwd_for_error),
            ],
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
    emit_lifecycle_event(
        trigger,
        &previous,
        &rt.lifecycle,
        rt.operation_id,
        port,
        detail,
    );
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
    app: tauri::AppHandle,
    operation_id: u64,
    started_at: u64,
    port: u16,
) {
    thread::spawn(move || {
        let spawned = spawn_server_process(&app, port);
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
        port: u16,
        operation_id: u64,
        started_at: u64,
        status: ServerStatus,
    },
}

fn begin_start_transition(rt: &mut ServerRuntime) -> StartAction {
    let current_port = rt.selected_port;
    let current = build_status(rt, current_port);
    if matches!(
        current.state,
        ServerLifecycleState::Starting
            | ServerLifecycleState::Running
            | ServerLifecycleState::Stopping
    ) {
        return StartAction::Noop(current);
    }

    let selected_port = match choose_available_port(current_port) {
        Ok(port) => port,
        Err(error) => {
            mark_failed(
                rt,
                error,
                "begin_start_transition_port_resolve_failed",
                Some(current_port),
            );
            return StartAction::Noop(status_from_runtime(rt, false, current_port));
        }
    };

    rt.selected_port = selected_port;
    let started_at = now_ms();
    rt.operation_id += 1;
    let operation_id = rt.operation_id;
    set_lifecycle(
        rt,
        ServerLifecycle::Starting { started_at },
        "begin_start_transition",
        Some(selected_port),
        None,
    );
    rt.last_seen_at = None;
    StartAction::Start {
        port: selected_port,
        operation_id,
        started_at,
        status: status_from_runtime(rt, false, selected_port),
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

fn begin_stop_transition(rt: &mut ServerRuntime) -> StopAction {
    let port = rt.selected_port;
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
    let mut rt = state.runtime.lock().map_err(|e| e.to_string())?;
    let port = rt.selected_port;
    Ok(build_status(&mut rt, port))
}

#[tauri::command]
pub fn server_start(
    app: tauri::AppHandle,
    state: State<'_, ServerState>,
) -> Result<ServerStatus, String> {
    let runtime_arc = Arc::clone(&state.runtime);
    let mut rt = state.runtime.lock().map_err(|e| e.to_string())?;
    match begin_start_transition(&mut rt) {
        StartAction::Noop(status) => Ok(status),
        StartAction::Start {
            port,
            operation_id,
            started_at,
            status,
        } => {
            drop(rt);
            start_in_background(runtime_arc, app, operation_id, started_at, port);
            Ok(status)
        }
    }
}

#[tauri::command]
pub fn server_stop(state: State<'_, ServerState>) -> Result<ServerStatus, String> {
    let runtime_arc = Arc::clone(&state.runtime);
    let mut rt = state.runtime.lock().map_err(|e| e.to_string())?;
    match begin_stop_transition(&mut rt) {
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
    let mut rt = state.runtime.lock().map_err(|e| e.to_string())?;
    let port = rt.selected_port;
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
            mark_failed(
                &mut rt,
                error.clone(),
                "server_stop_for_shutdown_failed",
                Some(port),
            );
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
    use std::fs;
    use std::io::Result as IoResult;
    use std::net::TcpListener;
    use std::path::Path;
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
            selected_port: DEFAULT_PORT,
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
            selected_port: DEFAULT_PORT,
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
            selected_port: DEFAULT_PORT,
            operation_id: 0,
            last_exit: None,
            last_seen_at: None,
        }
    }

    #[test]
    fn start_transition_is_idempotent_while_starting() {
        let mut rt = runtime_with(ServerLifecycle::Stopped);
        let first = begin_start_transition(&mut rt);
        match first {
            StartAction::Start { status, .. } => {
                assert_eq!(status.state, ServerLifecycleState::Starting);
            }
            StartAction::Noop(_) => panic!("first start should transition to starting"),
        }

        let second = begin_start_transition(&mut rt);
        match second {
            StartAction::Noop(status) => {
                assert_eq!(status.state, ServerLifecycleState::Starting);
            }
            StartAction::Start { .. } => panic!("second start should be no-op"),
        }
    }

    #[test]
    fn failed_state_can_retry_start() {
        let mut rt = runtime_with(ServerLifecycle::Failed {
            error: "spawn failed".to_string(),
            at: now_ms(),
        });

        let next = begin_start_transition(&mut rt);
        match next {
            StartAction::Start { status, .. } => {
                assert_eq!(status.state, ServerLifecycleState::Starting);
                assert_eq!(status.error, None);
            }
            StartAction::Noop(_) => panic!("failed state should allow retry"),
        }
    }

    #[test]
    fn start_transition_falls_back_to_next_available_port() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind test listener");
        let occupied_port = listener.local_addr().expect("read listener addr").port();
        let mut rt = runtime_with(ServerLifecycle::Stopped);
        rt.selected_port = occupied_port;

        let next = begin_start_transition(&mut rt);
        match next {
            StartAction::Start { port, status, .. } => {
                assert_ne!(port, occupied_port);
                assert_eq!(rt.selected_port, port);
                assert_eq!(status.port, port);
            }
            StartAction::Noop(_) => panic!("start should fallback to an available port"),
        }
    }

    #[test]
    fn start_transition_marks_failed_when_port_resolution_is_exhausted() {
        let max_port = u16::MAX;
        let _listener = TcpListener::bind(("127.0.0.1", max_port)).ok();
        assert!(
            check_port_in_use(max_port),
            "expected max port to be occupied for port resolution exhaustion test"
        );

        let mut rt = runtime_with(ServerLifecycle::Stopped);
        rt.selected_port = max_port;

        let next = begin_start_transition(&mut rt);
        match next {
            StartAction::Noop(status) => {
                assert_eq!(status.state, ServerLifecycleState::Failed);
                let error = status.error.unwrap_or_default();
                assert!(error.contains("[port_resolve]"));
                assert!(error.contains("preferred=65535"));
                assert_eq!(status.port, max_port);
            }
            StartAction::Start { .. } => {
                panic!("start should fail when preferred port is max and already occupied")
            }
        }
    }

    #[test]
    fn stop_transition_is_idempotent_outside_running() {
        let mut stopped = runtime_with(ServerLifecycle::Stopped);
        let noop = begin_stop_transition(&mut stopped);
        match noop {
            StopAction::Noop(status) => assert_eq!(status.state, ServerLifecycleState::Stopped),
            StopAction::Stop { .. } => panic!("stopped should remain noop"),
        }

        let mut failed = runtime_with(ServerLifecycle::Failed {
            error: "boom".to_string(),
            at: now_ms(),
        });
        let noop_failed = begin_stop_transition(&mut failed);
        match noop_failed {
            StopAction::Noop(status) => assert_eq!(status.state, ServerLifecycleState::Failed),
            StopAction::Stop { .. } => panic!("failed should remain noop"),
        }
    }

    #[test]
    fn stop_transition_moves_running_to_stopping_once() {
        let mut rt = runtime_with_running_child();

        let first = begin_stop_transition(&mut rt);
        match first {
            StopAction::Stop { status, child, .. } => {
                assert_eq!(status.state, ServerLifecycleState::Stopping);
                assert!(child.is_some());
            }
            StopAction::Noop(_) => panic!("running should transition to stopping"),
        }

        let second = begin_stop_transition(&mut rt);
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

    fn unique_temp_path(name: &str) -> PathBuf {
        let pid = std::process::id();
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        std::env::temp_dir().join(format!("cli-commentator-{name}-{pid}-{nanos}"))
    }

    fn touch_file(path: &Path) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("create parent directories");
        }
        fs::write(path, b"test").expect("write file");
    }

    #[test]
    fn resolve_node_binary_path_prefers_manifest_relative_path() {
        let root = unique_temp_path("node-manifest");
        let sidecar_root = root.join("Contents").join("Resources");
        let exe_dir = root.join("Contents").join("MacOS");
        let manifest_node = "binaries/node-x86_64-apple-darwin/node";
        let manifest_node_path = sidecar_root.join(manifest_node);
        touch_file(&manifest_node_path);
        touch_file(&exe_dir.join("node"));

        let resolved = resolve_node_binary_path(&sidecar_root, manifest_node, Some(&exe_dir))
            .expect("resolve node binary");
        assert_eq!(resolved, manifest_node_path);

        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn resolve_node_binary_path_falls_back_to_executable_node() {
        let root = unique_temp_path("node-fallback");
        let sidecar_root = root.join("Contents").join("Resources");
        let exe_dir = root.join("Contents").join("MacOS");
        let manifest_node = "binaries/node-x86_64-apple-darwin/node";
        #[cfg(windows)]
        let fallback_node = exe_dir.join("node.exe");
        #[cfg(not(windows))]
        let fallback_node = exe_dir.join("node");
        touch_file(&fallback_node);

        let resolved = resolve_node_binary_path(&sidecar_root, manifest_node, Some(&exe_dir))
            .expect("resolve node binary");
        assert_eq!(resolved, fallback_node);

        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn sidecar_missing_errors_include_sidecar_root_context() {
        let manifest_path = PathBuf::from(
            "/Applications/CLI Commentator.app/Contents/Resources/sidecar-manifest.json",
        );
        let sidecar_root = PathBuf::from("/Applications/CLI Commentator.app/Contents/Resources");
        let server_entry = sidecar_root.join("server/dist/index.js");
        let server_root = sidecar_root.join("server");

        let entry_error = format_sidecar_server_entry_missing_failure(
            &manifest_path,
            &sidecar_root,
            &server_entry,
        );
        let root_error =
            format_sidecar_server_root_missing_failure(&manifest_path, &sidecar_root, &server_root);

        assert!(entry_error.contains("[sidecar_server_entry_missing]"));
        assert!(entry_error.contains(&format!(
            "sidecar_root={}",
            sidecar_root.display()
        )));
        assert!(entry_error.contains(&format!(
            "server_entry={}",
            server_entry.display()
        )));
        assert!(root_error.contains("[sidecar_server_root_missing]"));
        assert!(root_error.contains(&format!(
            "sidecar_root={}",
            sidecar_root.display()
        )));
        assert!(root_error.contains(&format!(
            "server_root={}",
            server_root.display()
        )));
    }

    #[test]
    fn sidecar_node_missing_error_includes_candidate_context() {
        let manifest_path = PathBuf::from(
            "/Applications/CLI Commentator.app/Contents/Resources/sidecar-manifest.json",
        );
        let sidecar_root = PathBuf::from("/Applications/CLI Commentator.app/Contents/Resources");
        let expected = sidecar_root.join("binaries/node-aarch64-apple-darwin/node");
        let executable_dir = PathBuf::from("/Applications/CLI Commentator.app/Contents/MacOS");
        let candidates = vec![expected.clone(), executable_dir.join("node")];

        let error = format_sidecar_node_missing_failure(
            &manifest_path,
            &sidecar_root,
            &expected,
            &candidates,
            Some(&executable_dir),
        );

        assert!(error.contains("[sidecar_node_missing]"));
        assert!(error.contains(&format!(
            "sidecar_root={}",
            sidecar_root.display()
        )));
        assert!(error.contains(&format!(
            "candidates={},{}",
            expected.display(),
            executable_dir.join("node").display()
        )));
        assert!(error.contains(&format!(
            "executable_dir={}",
            executable_dir.display()
        )));
    }
}
