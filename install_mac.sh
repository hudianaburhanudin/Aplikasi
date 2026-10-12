#!/bin/bash
# Memasang OCR PDF sebagai layanan latar belakang di macOS (LaunchAgent).
# Jalan otomatis saat login, hidup lagi bila mati, tidak butuh Terminal.
# Pakai:  ./install_mac.sh            (pasang / perbarui)
#         ./install_mac.sh uninstall  (hapus)
set -e
LABEL="com.ocrpdf.app"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DIR="$(cd "$(dirname "$0")" && pwd)"
PORT="${PORT:-5050}"
LOG="$HOME/Library/Logs/ocr-pdf.log"
DOM="gui/$(id -u)"

if [ "$1" = "uninstall" ]; then
  launchctl bootout "$DOM/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Layanan dihapus."
  exit 0
fi

[ "$(uname)" = "Darwin" ] || { echo "Skrip ini hanya untuk macOS."; exit 1; }

# Siapkan lingkungan Python bila belum ada
if [ ! -x "$DIR/.venv/bin/python" ]; then
  python3 -m venv "$DIR/.venv"
fi
"$DIR/.venv/bin/pip" install -q -r "$DIR/requirements.txt"

# Pastikan Tesseract & Ghostscript ada
BREW_BIN="/opt/homebrew/bin:/usr/local/bin"
if ! PATH="$BREW_BIN:$PATH" command -v tesseract >/dev/null; then
  echo "Tesseract belum terpasang. Jalankan dulu: brew install tesseract tesseract-lang ghostscript"
  exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array>
    <string>$DIR/.venv/bin/python</string><string>$DIR/app.py</string>
  </array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>EnvironmentVariables</key><dict>
    <key>PORT</key><string>$PORT</string>
    <key>PATH</key><string>$BREW_BIN:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict></plist>
PL

launchctl bootout "$DOM/$LABEL" 2>/dev/null || true
launchctl bootstrap "$DOM" "$PLIST"
sleep 2
echo "Terpasang. Buka: http://127.0.0.1:$PORT"
echo "Log bila ada masalah: $LOG"
open "http://127.0.0.1:$PORT" 2>/dev/null || true
