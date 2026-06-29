#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_FILE="$ROOT_DIR/.typinglab.pid"
LAUNCHER_PID_FILE="$ROOT_DIR/.typinglab.launcher.pid"
URL_FILE="$ROOT_DIR/.typinglab.url"
HOST="${TYPINGLAB_HOST:-127.0.0.1}"
START_PORT="${TYPINGLAB_PORT:-5173}"
MODE="${TYPINGLAB_MODE:-preview}"
AUTO_INSTALL="${TYPINGLAB_AUTO_INSTALL:-1}"
MISSING_DEPENDENCY_BINS=()

cd "$ROOT_DIR"

for node_bin_dir in /opt/homebrew/bin /usr/local/bin; do
  if [[ -d "$node_bin_dir" && ":$PATH:" != *":$node_bin_dir:"* ]]; then
    PATH="$node_bin_dir:$PATH"
  fi
done
export PATH

find_port() {
  local port="$1"
  while [[ "$port" -le 5199 ]]; do
    if ! is_port_busy "$port"; then
      echo "$port"
      return 0
    fi
    port=$((port + 1))
  done
  echo "No free local port found in 5173-5199." >&2
  return 1
}

is_port_busy() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
    return $?
  fi
  if command -v nc >/dev/null 2>&1; then
    nc -z "$HOST" "$port" >/dev/null 2>&1
    return $?
  fi
  return 1
}

needs_build() {
  local dist_index="$ROOT_DIR/dist/index.html"
  if [[ ! -f "$dist_index" ]]; then
    return 0
  fi
  local newer
  newer="$(
    find \
      "$ROOT_DIR/src" \
      "$ROOT_DIR/public" \
      "$ROOT_DIR/index.html" \
      "$ROOT_DIR/package.json" \
      "$ROOT_DIR/package-lock.json" \
      "$ROOT_DIR/tsconfig.json" \
      "$ROOT_DIR/vite.config.ts" \
      -newer "$dist_index" \
      -print \
      -quit 2>/dev/null || true
  )"
  [[ -n "$newer" ]]
}

open_url() {
  local url="$1"
  if command -v open >/dev/null 2>&1; then
    open "$url" >/dev/null 2>&1 || echo "Open manually: $url"
    return
  fi
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$url" >/dev/null 2>&1 || true
    return
  fi
  echo "Open manually: $url"
}

with_launch_nonce() {
  local url="$1"
  local base="${url%%\?*}"
  echo "${base}?typinglab_launch=$(date +%s)"
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

is_typinglab_process_running() {
  local pid="$1"
  is_process_running "$pid" && is_typinglab_process "$pid"
}

ensure_node_tooling() {
  if ! command -v node >/dev/null 2>&1; then
    echo "Node.js is required. Install Node.js 18+ first, then run npm run open again." >&2
    exit 1
  fi
  if ! command -v npm >/dev/null 2>&1; then
    echo "npm is required. Install Node.js 18+ with npm, then run npm run open again." >&2
    exit 1
  fi

  local node_major
  node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if [[ "$node_major" =~ ^[0-9]+$ ]] && [[ "$node_major" -lt 18 ]]; then
    echo "TypingLab requires Node.js 18+. Current Node.js major version: $node_major." >&2
    exit 1
  fi
}

ensure_dependencies() {
  collect_missing_dependency_bins

  if [[ "${#MISSING_DEPENDENCY_BINS[@]}" -eq 0 ]]; then
    return
  fi
  if [[ "$AUTO_INSTALL" == "0" ]]; then
    echo "Missing dependencies (${MISSING_DEPENDENCY_BINS[*]}). Run: npm ci" >&2
    exit 1
  fi

  ensure_node_tooling
  echo "Installing TypingLab dependencies..."
  local install_command=(npm install)
  if [[ -f "$ROOT_DIR/package-lock.json" ]]; then
    install_command=(npm ci)
  fi
  if ! "${install_command[@]}"; then
    echo "Dependency install failed. Check network/npm access, then run npm ci manually." >&2
    exit 1
  fi
  collect_missing_dependency_bins
  if [[ "${#MISSING_DEPENDENCY_BINS[@]}" -gt 0 ]]; then
    echo "Dependency install finished, but required tools are still missing (${MISSING_DEPENDENCY_BINS[*]}). Run npm ci manually and retry." >&2
    exit 1
  fi
}

collect_missing_dependency_bins() {
  MISSING_DEPENDENCY_BINS=()
  if [[ ! -x "$ROOT_DIR/node_modules/.bin/vite" ]]; then
    MISSING_DEPENDENCY_BINS+=("vite")
  fi
  if [[ "$MODE" == "preview" && ! -x "$ROOT_DIR/node_modules/.bin/tsc" ]]; then
    MISSING_DEPENDENCY_BINS+=("tsc")
  fi
}

if [[ -f "$PID_FILE" || -f "$LAUNCHER_PID_FILE" ]]; then
  EXISTING_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  EXISTING_LAUNCHER_PID="$(cat "$LAUNCHER_PID_FILE" 2>/dev/null || true)"
  if is_typinglab_process_running "$EXISTING_PID" || is_typinglab_process_running "$EXISTING_LAUNCHER_PID"; then
    EXISTING_URL="$(with_launch_nonce "$(cat "$URL_FILE" 2>/dev/null || echo "http://$HOST:$START_PORT/")")"
    open_url "$EXISTING_URL"
    echo "TypingLab already running at $EXISTING_URL"
    exit 0
  fi
  echo "Removed stale TypingLab runtime files."
  rm -f "$PID_FILE" "$LAUNCHER_PID_FILE" "$URL_FILE"
fi

ensure_node_tooling
ensure_dependencies

PORT="$(find_port "$START_PORT")"
URL="$(with_launch_nonce "http://$HOST:$PORT/")"

if [[ "$MODE" == "preview" ]]; then
  if needs_build; then
    echo "Building TypingLab preview..."
    npm run build
  fi
  "$ROOT_DIR/node_modules/.bin/vite" preview --host "$HOST" --port "$PORT" --strictPort &
else
  "$ROOT_DIR/node_modules/.bin/vite" --host "$HOST" --port "$PORT" --strictPort &
fi

SERVER_PID="$!"
echo "$$" > "$LAUNCHER_PID_FILE"
echo "$SERVER_PID" > "$PID_FILE"
echo "$URL" > "$URL_FILE"

cleanup() {
  if kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -f "$PID_FILE" "$LAUNCHER_PID_FILE" "$URL_FILE"
}

trap cleanup INT TERM EXIT

echo "Starting TypingLab at $URL"
sleep 1
if ! kill -0 "$SERVER_PID" 2>/dev/null; then
  wait "$SERVER_PID"
fi
echo "TypingLab running at $URL"
echo "Close this terminal or press Ctrl+C to stop the local server."
open_url "$URL"
wait "$SERVER_PID"
