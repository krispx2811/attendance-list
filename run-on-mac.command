#!/bin/bash
# Double-click this file to run Attendance List on macOS.
# Sets up the virtual environment on first run, then just launches the app.

cd "$(dirname "$0")" || exit 1

if [ ! -x .venv/bin/python ]; then
    echo "First run — setting up (this takes a minute)…"
    python3 -m venv .venv || { echo "Could not create the virtual environment."; read -r; exit 1; }
    .venv/bin/python -m pip install --quiet --upgrade pip
    .venv/bin/python -m pip install --quiet -r requirements.txt || { echo "Could not install dependencies."; read -r; exit 1; }
    echo "Setup complete."
fi

exec .venv/bin/python main.py
