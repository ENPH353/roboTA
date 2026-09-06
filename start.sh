#!/bin/bash
# Find the directory where this script is saved
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# 1. Run Flask in the BACKGROUND using the ampersand (&)
"$DIR/roboTA_venv/bin/python" "$DIR/app.py" &

# 2. Pause for 1 second to give the Flask server a moment to bind to Port 5000
sleep 1

# 3. Automatically tell Firefox to open your local frontend interface
firefox "http://127.0.0.1:5000"
