#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_FILE="$ROOT_DIR/.typinglab.pid"
LAUNCHER_PID_FILE="$ROOT_DIR/.typinglab.launcher.pid"
URL_FILE="$ROOT_DIR/.typinglab.url"

read_pid() {
  local file="$1"
  cat "$file" 2>/dev/null || true
}

is_process_running() {
  local pid="$1"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

process_command() {
  local pid="$1"
  ps -p "$pid" -o command= 2>/dev/null || true
}

is_typinglab_process() {
  local pid="$1"
  local command
  command="$(process_command "$pid")"
  [[ "$command" == *"$ROOT_DIR"* ]]
}

stop_process() {
  local label="$1"
  local pid="$2"
  if [[ -z "$pid" ]]; then
    return 1
  fi
  if ! is_process_running "$pid"; then
    return 1
  fi
  if ! is_typinglab_process "$pid"; then
    echo "Skipped stale TypingLab $label pid $pid; it does not belong to this workspace." >&2
    return 1
  fi
  if kill "$pid" 2>/dev/null; then
    echo "Stopped TypingLab $label pid $pid."
    return 0
  fi
  echo "Could not stop TypingLab $label pid $pid. Close its terminal or rerun with sufficient permission." >&2
  return 2
}

if [[ ! -f "$PID_FILE" && ! -f "$LAUNCHER_PID_FILE" ]]; then
  echo "TypingLab is not running from this workspace."
  rm -f "$URL_FILE"
  exit 0
fi

LAUNCHER_PID="$(read_pid "$LAUNCHER_PID_FILE")"
SERVER_PID="$(read_pid "$PID_FILE")"

if [[ -z "$LAUNCHER_PID" && -z "$SERVER_PID" ]]; then
  rm -f "$PID_FILE" "$LAUNCHER_PID_FILE" "$URL_FILE"
  echo "Removed stale TypingLab runtime files."
  exit 0
fi

STOPPED=0
FAILED=0

stop_process "launcher" "$LAUNCHER_PID" && STOPPED=1 || {
  status=$?
  [[ "$status" -eq 2 ]] && FAILED=1
}

if [[ "$STOPPED" -eq 0 ]]; then
  stop_process "server" "$SERVER_PID" && STOPPED=1 || {
    status=$?
    [[ "$status" -eq 2 ]] && FAILED=1
  }
fi

if [[ "$FAILED" -eq 1 ]]; then
  exit 1
fi

if [[ "$STOPPED" -eq 1 ]]; then
  sleep 0.5
  rm -f "$PID_FILE" "$LAUNCHER_PID_FILE" "$URL_FILE"
  exit 0
fi

echo "TypingLab runtime files were stale; no running process was found."
rm -f "$PID_FILE" "$LAUNCHER_PID_FILE" "$URL_FILE"
