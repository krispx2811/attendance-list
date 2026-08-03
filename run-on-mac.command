#!/bin/bash
# Double-click this file to run Attendance List on macOS.
# Installs dependencies on first run, then just launches the app.

cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
    echo "Node.js is not installed. Get it from https://nodejs.org and try again."
    read -r
    exit 1
fi

if [ ! -d node_modules ]; then
    echo "First run — installing (this takes a minute)…"
    npm install || { echo "Install failed."; read -r; exit 1; }
    echo "Done."
fi

# VS Code and some other editors export this, which makes Electron run the app
# as a plain Node script instead of launching a window.
unset ELECTRON_RUN_AS_NODE

exec npm start
