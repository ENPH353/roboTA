#!/bin/bash
# Find the directory where this script is saved
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

if [ -f "$DIR/dist/roboTAapp" ]; then
    exec "$DIR/dist/roboTAapp"
else
    exec "$DIR/roboTA_venv/bin/python" "$DIR/app.py"
fi

# 2. Pause for 1 second to give the Flask server a moment to bind to Port 5000
sleep 1