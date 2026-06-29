#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FULL_CHECK="${TYPINGLAB_DOCTOR_FULL:-0}"
AUTO_INSTALL="${TYPINGLAB_AUTO_INSTALL:-1}"
ALLOW_LOCAL_SYNC_DATA="${TYPINGLAB_ALLOW_LOCAL_SYNC_DATA:-0}"

cd "$ROOT_DIR"

pass() {
  echo "[ok] $1"
}

fail() {
  echo "[fail] $1" >&2
  exit 1
}

run_step() {
  local label="$1"
  shift
  echo "[run] $label"
  "$@"
  pass "$label"
}

require_command() {
  local name="$1"
  command -v "$name" >/dev/null 2>&1 || fail "$name is required."
}

check_node() {
  require_command node
  require_command npm
  local node_major
  node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if ! [[ "$node_major" =~ ^[0-9]+$ ]]; then
    fail "Could not determine Node.js version."
  fi
  if [[ "$node_major" -lt 18 ]]; then
    fail "TypingLab requires Node.js 18+. Current major version: $node_major."
  fi
  pass "Node.js and npm are available."
}

check_dependencies() {
  [[ -f "$ROOT_DIR/package-lock.json" ]] || fail "package-lock.json is missing."
  if [[ ! -x "$ROOT_DIR/node_modules/.bin/vite" || ! -x "$ROOT_DIR/node_modules/.bin/vitest" || ! -x "$ROOT_DIR/node_modules/.bin/tsc" ]]; then
    if [[ "$AUTO_INSTALL" == "0" ]]; then
      fail "Dependencies are missing. Run: npm ci"
    fi
    echo "[run] Install dependencies"
    npm ci
    pass "Install dependencies"
  fi
  [[ -x "$ROOT_DIR/node_modules/.bin/vite" ]] || fail "Vite is missing after dependency install."
  [[ -x "$ROOT_DIR/node_modules/.bin/vitest" ]] || fail "Vitest is missing after dependency install."
  [[ -x "$ROOT_DIR/node_modules/.bin/tsc" ]] || fail "TypeScript compiler is missing after dependency install."
  pass "Node dependencies are installed."
}

check_release_scaffold() {
  [[ -f "$ROOT_DIR/.node-version" ]] || fail ".node-version is missing."
  local configured_node_major
  configured_node_major="$(tr -d '[:space:]' < "$ROOT_DIR/.node-version")"
  if ! [[ "$configured_node_major" =~ ^[0-9]+$ ]]; then
    fail ".node-version must contain a Node.js major version."
  fi
  if [[ "$configured_node_major" -lt 18 ]]; then
    fail ".node-version must be Node.js 18+."
  fi
  [[ -f "$ROOT_DIR/.npmrc" ]] || fail ".npmrc is missing."
  if ! grep -Fxq "engine-strict=true" "$ROOT_DIR/.npmrc"; then
    fail ".npmrc must enable engine-strict=true."
  fi

  [[ -f "$ROOT_DIR/.github/workflows/ci.yml" ]] || fail "GitHub Actions CI workflow is missing."
  if ! grep -Fq "npm run doctor:full" "$ROOT_DIR/.github/workflows/ci.yml"; then
    fail "CI workflow must run the full TypingLab doctor."
  fi

  node -e '
const pkg = require("./package.json");
const required = ["open", "doctor", "doctor:full", "test:smoke", "test", "build"];
const missing = required.filter((name) => !pkg.scripts || !pkg.scripts[name]);
if (missing.length > 0) {
  console.error(`Missing package scripts: ${missing.join(", ")}`);
  process.exit(1);
}
const bashScripts = {
  open: "bash scripts/open-typinglab.sh",
  stop: "bash scripts/stop-typinglab.sh",
  "install:launchers": "bash scripts/install-launchers.sh",
};
for (const [name, command] of Object.entries(bashScripts)) {
  if (pkg.scripts?.[name] !== command) {
    console.error(`package.json script ${name} must be: ${command}`);
    process.exit(1);
  }
}
if (!pkg.engines || pkg.engines.node !== ">=18" || pkg.engines.npm !== ">=9") {
  console.error("package.json engines must require node >=18 and npm >=9.");
  process.exit(1);
}
'
  pass "Release scaffold is present."
}

check_privacy_ignores() {
  local patterns=(
    "TypingLab/"
    "typinglab-sync-*.json"
    "typinglab-sync-folder-*.json"
    "typinglab-events-*.jsonl"
    "typinglab-sessions-*.csv"
    "typinglab-weekly-review-*.md"
  )

  for pattern in "${patterns[@]}"; do
    if ! grep -Fxq "$pattern" "$ROOT_DIR/.gitignore"; then
      fail ".gitignore is missing privacy pattern: $pattern"
    fi
  done
  pass "Training data export patterns are ignored."
}

check_no_private_training_exports() {
  local scan_file
  local found
  scan_file="${TMPDIR:-/tmp}/typinglab-doctor-privacy-$$.txt"
  find "$ROOT_DIR" -maxdepth 2 \
    \( -path "$ROOT_DIR/.git" -o -path "$ROOT_DIR/node_modules" -o -path "$ROOT_DIR/dist" \) -prune \
    -o \( \
      -name "TypingLab" \
      -o -name "typinglab-sync-*.json" \
      -o -name "typinglab-sync-folder-*.json" \
      -o -name "typinglab-events-*.jsonl" \
      -o -name "typinglab-sessions-*.csv" \
      -o -name "typinglab-weekly-review-*.md" \
    \) -print > "$scan_file" 2>/dev/null

  if [[ -s "$scan_file" ]]; then
    found="$(sed "s#^$ROOT_DIR/##" "$scan_file" | head -n 10)"
  else
    found=""
  fi
  rm -f "$scan_file"

  if [[ -n "$found" ]]; then
    if [[ "$ALLOW_LOCAL_SYNC_DATA" == "1" ]]; then
      echo "[warn] Local training data/export files are present in the project directory:"
      echo "$found"
      return
    fi
    echo "[fail] Local training data/export files are present in the project directory:" >&2
    echo "$found" >&2
    echo "Move them outside the repository, or rerun with TYPINGLAB_ALLOW_LOCAL_SYNC_DATA=1 if this is intentional." >&2
    exit 1
  fi

  pass "No local training data exports found in the project directory."
}

check_scripts() {
  run_step "Shell script syntax" \
    bash -n \
      "$ROOT_DIR/scripts/open-typinglab.sh" \
      "$ROOT_DIR/scripts/stop-typinglab.sh" \
      "$ROOT_DIR/scripts/install-launchers.sh" \
      "$ROOT_DIR/scripts/start-typinglab.sh"
}

check_node
check_dependencies
check_release_scaffold
check_privacy_ignores
check_no_private_training_exports
check_scripts
run_step "Smoke tests" npm run test:smoke

if [[ "$FULL_CHECK" == "1" ]]; then
  run_step "Full test suite" npm test
fi

run_step "Production build" npm run build

pass "TypingLab doctor completed."
