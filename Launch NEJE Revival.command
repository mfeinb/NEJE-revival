#!/bin/zsh
set -e

project_dir="${0:A:h}"
cd "$project_dir"

python_path="$project_dir/.venv/bin/python"
if [[ ! -x "$python_path" ]]; then
  if ! command -v python3 >/dev/null 2>&1; then
    echo "Python 3 is required. Install it from https://www.python.org/downloads/macos/"
    echo "Press any key to close."
    read -k 1
    exit 1
  fi
  echo "Preparing NEJE Revival for its first run..."
  python3 -m venv "$project_dir/.venv"
fi

if ! "$python_path" -c 'import serial' >/dev/null 2>&1; then
  echo "Installing the local serial-port dependency..."
  "$python_path" -m pip install -r "$project_dir/requirements.txt"
fi

echo "Starting NEJE Revival. Keep this window open while using the engraver."
echo "Close it or press Control-C to stop the app."
exec "$python_path" -m neje_control.server
