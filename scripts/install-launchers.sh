#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LAUNCHER_DIR="$ROOT_DIR/launchers"
MAC_LAUNCHER="$LAUNCHER_DIR/TypingLab.command"
LINUX_LAUNCHER="$LAUNCHER_DIR/typinglab.desktop"

mkdir -p "$LAUNCHER_DIR"
chmod +x \
  "$ROOT_DIR/scripts/open-typinglab.sh" \
  "$ROOT_DIR/scripts/stop-typinglab.sh" \
  "$ROOT_DIR/scripts/start-typinglab.sh" \
  "$ROOT_DIR/scripts/install-launchers.sh"

cat > "$MAC_LAUNCHER" <<EOF
#!/usr/bin/env bash
cd "$ROOT_DIR"
exec bash "$ROOT_DIR/scripts/open-typinglab.sh"
EOF

cat > "$LINUX_LAUNCHER" <<EOF
[Desktop Entry]
Type=Application
Name=TypingLab
Comment=Local-first typing practice
Exec=bash $ROOT_DIR/scripts/open-typinglab.sh
Path=$ROOT_DIR
Terminal=true
Categories=Education;Utility;
EOF

chmod +x "$MAC_LAUNCHER" "$LINUX_LAUNCHER"

echo "Created:"
echo "  $MAC_LAUNCHER"
echo "  $LINUX_LAUNCHER"
echo
echo "macOS: double-click TypingLab.command."
echo "Ubuntu: copy typinglab.desktop to ~/.local/share/applications/ if you want it in the app launcher."
