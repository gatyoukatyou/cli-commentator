#!/usr/bin/env bash
#
# LLM Smoke Test for cli-commentator
# Tests that a provider can produce commentary for a simple echo command.
#
# Usage:
#   pnpm smoke:llm <provider>     # Test single provider
#   pnpm smoke:llm --all          # Test all configured providers
#
# Exit Codes:
#   0 - LLM responded successfully
#   1 - Missing required environment variable
#   2 - Server startup failed
#   3 - No commentary event received
#   4 - Invalid provider argument
#   5 - Fallback to rule-based (LLM failed gracefully)
#
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

VALID_PROVIDERS="openai opencode-go groq gemini anthropic local mock"

get_external_env_file() {
  if [[ -n "${CLI_COMMENTATOR_ENV_FILE:-}" ]]; then
    printf '%s\n' "$CLI_COMMENTATOR_ENV_FILE"
  elif [[ -n "${XDG_CONFIG_HOME:-}" ]]; then
    printf '%s/cli-commentator/env\n' "$XDG_CONFIG_HOME"
  else
    printf '%s/.config/cli-commentator/env\n' "${HOME:-}"
  fi
}

external_env_has_value() {
  local key=$1
  local env_file
  env_file=$(get_external_env_file)
  [[ -f "$env_file" ]] || return 1
  awk -F= -v key="$key" '$1 == key && length($0) > length(key) + 1 { found = 1 } END { exit !found }' "$env_file"
}

# --- Helper functions ---
log() {
  echo "[smoke-llm] $*"
}

log_ok() {
  echo "[smoke-llm] OK: $*"
}

log_warn() {
  echo "[smoke-llm] WARN: $*"
}

log_err() {
  echo "[smoke-llm] ERROR: $*"
}

usage() {
  cat <<EOF
Usage: $(basename "$0") [OPTIONS] <provider>

Test LLM provider integration with a simple echo command.

Providers: $VALID_PROVIDERS

Options:
  --all       Test all providers with configured API keys
  --help, -h  Show this help

Environment Variables:
  COMMENT_TIMEOUT_MS    LLM call timeout (default: 3000)

Exit Codes:
  0   LLM responded successfully
  1   Missing required environment variable
  2   Server startup failed
  3   No commentary received within timeout
  4   Invalid provider argument
  5   Fallback to rule-based (LLM failed gracefully)

Examples:
  $(basename "$0") openai                    # Test OpenAI
  COMMENT_TIMEOUT_MS=100 $(basename "$0") openai  # Test timeout behavior
  $(basename "$0") --all                     # Test all configured providers
EOF
  exit 0
}

# Get required env var for provider
get_required_env() {
  local provider=$1
  case "$provider" in
    openai) echo "OPENAI_API_KEY" ;;
    opencode-go) echo "OPENCODE_GO_API_KEY" ;;
    groq) echo "GROQ_API_KEY" ;;
    gemini) echo "GOOGLE_API_KEY" ;;
    anthropic) echo "ANTHROPIC_API_KEY" ;;
    local) echo "" ;;
    mock) echo "" ;;
    *) echo "" ;;
  esac
}

validate_provider() {
  local provider=$1
  local valid=false
  for p in $VALID_PROVIDERS; do
    if [[ "$p" == "$provider" ]]; then
      valid=true
      break
    fi
  done
  if [[ "$valid" != "true" ]]; then
    log_err "Invalid provider: $provider"
    log "Valid providers: $VALID_PROVIDERS"
    exit 4
  fi
}

check_env() {
  local provider=$1
  local required
  required=$(get_required_env "$provider")

  if [[ -n "$required" ]]; then
    local val="${!required:-}"
    if [[ -z "$val" ]] && ! external_env_has_value "$required"; then
      log_err "$required is required for $provider provider"
      exit 1
    fi
    log "  $required: set"
  else
    log "  (no required env)"
  fi
}

# Get timeout command (macOS compatibility)
get_timeout_cmd() {
  if command -v gtimeout &>/dev/null; then
    echo "gtimeout"
  elif command -v timeout &>/dev/null; then
    echo "timeout"
  else
    echo ""
  fi
}

run_smoke() {
  local provider=$1
  local timeout_ms=${COMMENT_TIMEOUT_MS:-3000}
  local tmplog
  tmplog=$(mktemp)

  # Cleanup on exit
  trap "rm -f '$tmplog'" RETURN

  log "Provider: $provider"
  log "Checking environment..."
  check_env "$provider"

  log "Starting server (COMMENT_TIMEOUT_MS=${timeout_ms})..."

  # Export configuration
  export DEBUG=1
  export LLM_PROVIDER="$provider"
  export TARGET_CMD="echo"
  export TARGET_ARGS="hello-smoke-test"
  export COMMENT_TIMEOUT_MS="$timeout_ms"
  export COMMENT_EXIT_TIMEOUT_MS="2000"

  local timeout_cmd
  timeout_cmd=$(get_timeout_cmd)

  local exit_code=0
  if [[ -n "$timeout_cmd" ]]; then
    $timeout_cmd 15s pnpm --dir "$PROJECT_ROOT" dev:server >"$tmplog" 2>&1 || exit_code=$?
  else
    # Manual timeout for systems without timeout command
    pnpm --dir "$PROJECT_ROOT" dev:server >"$tmplog" 2>&1 &
    local pid=$!
    (sleep 15 && kill $pid 2>/dev/null) &
    local watchdog=$!
    wait $pid 2>/dev/null || exit_code=$?
    kill $watchdog 2>/dev/null || true
  fi

  # Analyze results from log
  if grep -q "comment_ok" "$tmplog"; then
    log_ok "LLM responded successfully"
    return 0
  elif grep -q "comment_timeout" "$tmplog"; then
    log_warn "Timeout - fallback to rule-based"
    return 5
  elif grep -q "comment_llm_error" "$tmplog"; then
    log_warn "LLM error - fallback to rule-based"
    return 5
  elif grep -q "server listening\|WebSocket server" "$tmplog"; then
    log_err "Server started but no commentary events detected"
    return 3
  else
    log_err "Server may not have started correctly"
    if [[ -s "$tmplog" ]]; then
      log "Last 10 lines of log:"
      tail -10 "$tmplog" | sed 's/^/  /'
    fi
    return 2
  fi
}

run_all() {
  local providers="openai opencode-go groq gemini anthropic local mock"
  local results=""
  local any_failure=0

  log "Testing all providers..."
  echo

  for provider in $providers; do
    local required
    required=$(get_required_env "$provider")

    # Skip if required env not set
    if [[ -n "$required" ]]; then
      local val="${!required:-}"
      if [[ -z "$val" ]]; then
        log "$provider: SKIPPED (no $required)"
        results="$results $provider:skip"
        continue
      fi
    fi

    log "=== Testing $provider ==="

    # Run in subshell to capture exit code
    local code=0
    (run_smoke "$provider") || code=$?
    results="$results $provider:$code"

    if [[ $code -ne 0 && $code -ne 5 ]]; then
      any_failure=1
    fi

    echo
  done

  log "=== Summary ==="
  for r in $results; do
    local p=${r%%:*}
    local c=${r##*:}
    case $c in
      0) log "  $p: OK" ;;
      5) log "  $p: FALLBACK (rule-based)" ;;
      skip) log "  $p: SKIPPED" ;;
      *) log "  $p: FAILED (exit $c)" ;;
    esac
  done

  return $any_failure
}

# --- Main ---
PROVIDER=""
RUN_ALL=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --help|-h)
      usage
      ;;
    --all)
      RUN_ALL=true
      shift
      ;;
    -*)
      log_err "Unknown option: $1"
      usage
      ;;
    *)
      PROVIDER="$1"
      shift
      ;;
  esac
done

if [[ "$RUN_ALL" == true ]]; then
  run_all
elif [[ -n "$PROVIDER" ]]; then
  validate_provider "$PROVIDER"
  run_smoke "$PROVIDER"
else
  log_err "No provider specified"
  echo
  usage
fi
