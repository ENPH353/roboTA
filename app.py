from flask import Flask, request, Response, jsonify, render_template
from flask_cors import CORS
import os
import json
import base64

from services import sync_api_key, sync_cache, generate_export_md, generate_llm_stream

app = Flask(__name__)
CORS(app)

# Constants & Paths
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
EXPORT_DIR = os.path.join(BASE_DIR, 'chat_logs')
STUDENT_NUM_DIR = os.path.join(BASE_DIR, 'student_numbers')
INSTRUCTION_DIR = os.path.join(BASE_DIR, 'lab_instructions')

INSTRUCTIONS_FILE = os.path.join(INSTRUCTION_DIR, 'lab_instructions.json')
STUDENT_NUM_FILE = os.path.join(STUDENT_NUM_DIR, 'student_numbers.json')
SAVED_STUDENT_FILE = os.path.join(STUDENT_NUM_DIR, 'saved_student.json')

for d in [EXPORT_DIR, STUDENT_NUM_DIR, INSTRUCTION_DIR]:
    os.makedirs(d, exist_ok=True)

# Global Application State
APP_STATE = {
    "CLOUD_API_URL": "https://ai-stg.apps.ctlt.ubc.ca/v1/chat/completions",
    "CLOUD_MODEL": "qwen3.6-35b-a3b",
    "CLOUD_API_KEY": "",
    "OLLAMA_URL": "http://127.0.0.1:11434/api/chat",
    "OLLAMA_MODEL": "phi4-mini:latest",
    "LAB_INSTRUCTIONS": {},
    "STUDENT_NUMBERS": set(),
    "FETCH_KEY_URL": "https://api.00000043.xyz/api/get_key"
}

# Boot-up Sync
APP_STATE["LAB_INSTRUCTIONS"] = sync_cache("https://api.00000043.xyz/api/lab_instructions", INSTRUCTIONS_FILE, {})
APP_STATE["STUDENT_NUMBERS"] = set(sync_cache("https://api.00000043.xyz/api/student_numbers", STUDENT_NUM_FILE, []))


@app.route('/')
def serve_frontend():
    """Serves the main HTML interface."""
    return render_template('index.html')

@app.route('/get_saved_student', methods=['GET'])
def get_saved_student():
    if os.path.exists(SAVED_STUDENT_FILE):
        try:
            with open(SAVED_STUDENT_FILE, 'r', encoding='utf-8') as f:
                saved_id = str(json.load(f).get('student_id', '')).strip()
                if saved_id in APP_STATE["STUDENT_NUMBERS"]:
                    APP_STATE["CLOUD_API_KEY"] = sync_api_key(saved_id, APP_STATE["FETCH_KEY_URL"])
                    return jsonify({"saved": True, "student_id": saved_id})
        except Exception:
            pass
    return jsonify({"saved": False})

@app.route('/verify_student', methods=['POST'])
def verify_student():
    student_id = str(request.json.get('student_id', '')).strip()
    if student_id in APP_STATE["STUDENT_NUMBERS"]:
        APP_STATE["CLOUD_API_KEY"] = sync_api_key(student_id, APP_STATE["FETCH_KEY_URL"])
        try:
            with open(SAVED_STUDENT_FILE, 'w', encoding='utf-8') as f:
                json.dump({"student_id": student_id}, f, indent=2)
        except Exception:
            pass
        return jsonify({"valid": True})
    return jsonify({"valid": False}), 403

@app.route('/forget_student', methods=['POST'])
def forget_student():
    APP_STATE["CLOUD_API_KEY"] = ""
    if os.path.exists(SAVED_STUDENT_FILE):
        os.remove(SAVED_STUDENT_FILE)
    return jsonify({"status": "success"})

@app.route('/config', methods=['GET'])
def get_config():
    return jsonify({"cloud_model": APP_STATE["CLOUD_MODEL"], "ollama_model": APP_STATE["OLLAMA_MODEL"]})

@app.route('/export_lab', methods=['POST'])
def export_labs():
    try:
        filepath = generate_export_md(request.json, EXPORT_DIR)
        return jsonify({"status": "success", "filepath": filepath})
    except Exception as e:
        return Response(str(e), status=500)

@app.route('/submit', methods=['POST'])
def handle_chat():
    try:
        history = json.loads(request.form.get('messages', '[]'))
    except Exception as e:
        return Response("Invalid JSON", status=400)

    processed_files = []
    for f in request.files.getlist('file'):
        if f and f.filename:
            processed_files.append({"base64": base64.b64encode(f.read()).decode('utf-8'), "mime_type": f.content_type})

    payload = {
        "clean_history": [{"role": m.get("role"), "content": m.get("content")} for m in history],
        "processed_files": processed_files,
        "model_pref": request.form.get('model_preference', 'cloud'),
        "system_instruction": APP_STATE["LAB_INSTRUCTIONS"].get(request.form.get('project_id'), ""),
        "temperature": request.form.get('temperature', default=None, type=float),
        "top_p": request.form.get('top_p', default=None, type=float),
        "top_k": request.form.get('top_k', default=None, type=int)
    }

    headers = {'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'}
    return Response(generate_llm_stream(payload, APP_STATE), mimetype='text/event-stream', headers=headers)

if __name__ == '__main__':
    app.run(host='127.0.0.1', port=5000, threaded=True)