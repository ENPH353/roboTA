import os
import json
import requests
import datetime
import io
import base64
from PIL import Image
from pypdf import PdfReader


def extract_pdf_text_from_base64(b64_string):
    """Extracts plain text content from a base64-encoded PDF for non-native LLMs."""
    try:
        pdf_bytes = base64.b64decode(b64_string)
        reader = PdfReader(io.BytesIO(pdf_bytes))
        extracted_text = []
        for i, page in enumerate(reader.pages):
            text = page.extract_text()
            if text:
                extracted_text.append(f"--- Page {i+1} ---\n{text}")
        return "\n\n".join(extracted_text)
    except Exception as e:
        print(f"[PDF EXTRACTION ERROR] {e}")
        return "[Error extracting text from attached PDF document]"


def normalize_image_to_jpeg(b64_string):
    """Converts any incoming base64 image (WEBP, PNG, BMP, etc.) into standard JPEG for LiteLLM/OpenAI vision endpoints."""
    try:
        img_bytes = base64.b64decode(b64_string)
        img = Image.open(io.BytesIO(img_bytes))
        if img.mode in ("RGBA", "P"):
            img = img.convert("RGB")
        buffer = io.BytesIO()
        img.save(buffer, format="JPEG", quality=90)
        return base64.b64encode(buffer.getvalue()).decode('utf-8'), "image/jpeg"
    except Exception as e:
        print(f"[IMAGE CONVERSION ERROR] {e}")
        return b64_string, "image/jpeg"


def sync_api_key(student_id, fetch_url):
    """Fetches the API key from remote server."""
    if not student_id:
        return ""
    try:
        response = requests.post(fetch_url, json={"student_number": str(student_id)}, timeout=5)
        if response.status_code == 200:
            print("[INFO] API key successfully synced.")
            return response.json().get('api_key', '')
    except Exception as e:
        print(f"[ERROR] Failed to connect to key endpoint: {e}")
    return ""


def sync_cache(url, filepath, default_val):
    """Fetches JSON from remote URL; falls back to local cache if offline."""
    try:
        response = requests.get(url, timeout=5)
        if response.status_code == 200:
            data = response.json()
            with open(filepath, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2)
            print("[INFO] Successfully synced cache from remote server.")
            return data
    except Exception:
        print("[ERROR] Failed to sync cache. Using local.")
        pass 

    if os.path.exists(filepath):
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            pass
    return default_val


def generate_export_md(data, export_dir):
    """Compiles JSON chat data into a Markdown file."""
    project_id = data.get('project_id')
    project_label = data.get('project_label', project_id)
    chats = data.get('chats', {})
    student_id = data.get('student_id', 'unknown_student')

    md_content = [
        f"# Project Archive: {project_label}",
        f"Student ID: {student_id}",
        f"Exported on: {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"
    ]

    sorted_chat_ids = sorted(
        chats.keys(), 
        key=lambda x: int(x.split('_')[-1]) if x.split('_')[-1].isdigit() else 0
    )

    for chat_id in sorted_chat_ids:
        chat = chats[chat_id]
        md_content.extend([
            f"\n \n \n## Conversation: {chat.get('title', 'Untitled')}",
            f"## Chat id: {chat_id}",
            f"## Created at: {chat.get('createdAt', 'N/A')} \n"
        ])

        for msg in chat.get('messages', []):
            role = msg.get('role', '').upper()
            content = msg.get('content', '')
            source = msg.get('source', '')
            timestamp = msg.get('timestamp', '')
            
            in_tokens = msg.get('inputTokens')
            out_tokens = msg.get('outputTokens')

            time_str = f" — `{timestamp}`" if timestamp else ""
        
            if role == 'ASSISTANT':
                tok_str = f" — `[Output Tokens: {out_tokens}]`" if out_tokens is not None else ""
                md_content.append(f"\n \n \n### LLM ({source}{time_str}){tok_str}\n{content}\n")
            else:
                tok_str = f" — `[Input Tokens: {in_tokens}]`" if in_tokens is not None else ""
                md_content.append(f"\n \n \n### USER{time_str}{tok_str}\n{content}\n")

    export_filename = f"{student_id}_{project_id}_conversation_export.md"
    export_filepath = os.path.join(export_dir, export_filename)

    with open(export_filepath, "w", encoding="utf-8") as f:
        f.write("\n".join(md_content))
    return export_filepath


def generate_llm_stream(payload, app_state):
    """Handles the Server-Sent Events stream for LiteLLM and Ollama."""
    clean_history = payload['clean_history']
    processed_files = payload['processed_files']
    model_pref = payload['model_pref']
    sys_inst = payload['system_instruction']
    
    # 1. ATTEMPT LITELLM PROXY
    if model_pref == 'cloud' and app_state['CLOUD_API_KEY']:
        try:
            # Create a shallow copy of history to avoid mutating base state
            formatted_history = json.loads(json.dumps(clean_history))

            # PROCESS ATTACHED FILES FOR LITELLM / OPENAI SCHEMA
            if processed_files:
                current_text = formatted_history[-1]['content']
                content_blocks = []
                pdf_text_accumulator = ""

                for pf in processed_files:
                    # Convert images (WEBP, PNG, BMP) to JPEG data URIs
                    if pf["mime_type"].startswith('image/'):
                        jpeg_b64, mime_type = normalize_image_to_jpeg(pf["base64"])
                        content_blocks.append({
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:{mime_type};base64,{jpeg_b64}"
                            }
                        })
                    # Extract PDF text server-side
                    elif pf["mime_type"] == 'application/pdf':
                        extracted = extract_pdf_text_from_base64(pf["base64"])
                        pdf_text_accumulator += f"\n\n[Attached PDF Content]:\n{extracted}\n"

                final_text_prompt = current_text + pdf_text_accumulator
                content_blocks.insert(0, {"type": "text", "text": final_text_prompt})
                formatted_history[-1]['content'] = content_blocks

            # Build final messages list
            formatted_messages = []
            if sys_inst:
                formatted_messages.append({"role": "system", "content": sys_inst})
            formatted_messages.extend(formatted_history)

            headers = {
                "Authorization": f"Bearer {app_state['CLOUD_API_KEY']}",
                "Content-Type": "application/json"
            }

            req_data = {
                "model": app_state['CLOUD_MODEL'],
                "messages": formatted_messages,
                "stream": True,
                "stream_options": {"include_usage": True}
            }

            if payload['temperature'] is not None: 
                req_data["temperature"] = payload['temperature']
            if payload['top_p'] is not None: 
                req_data["top_p"] = payload['top_p']

            response = requests.post(
                app_state['CLOUD_API_URL'], 
                json=req_data, 
                headers=headers, 
                stream=True, 
                timeout=60
            )
            
            if response.status_code == 200:
                yield json.dumps({"t": "source", "c": f"LiteLLM ({app_state['CLOUD_MODEL']})"}) + "\n"
                
                for line in response.iter_lines():
                    if line:
                        line_str = line.decode('utf-8').strip()
                        if line_str.startswith("data:"):
                            data_str = line_str[5:].strip()
                            if data_str == "[DONE]":
                                break

                            try:
                                event_data = json.loads(data_str)

                                # Token usage object
                                usage = event_data.get("usage")
                                if usage:
                                    in_tok = usage.get("prompt_tokens", 0)
                                    out_tok = usage.get("completion_tokens", 0)
                                    yield json.dumps({
                                        "t": "usage", 
                                        "input_tokens": in_tok, 
                                        "output_tokens": out_tok
                                    }) + "\n"

                                choices = event_data.get("choices", [])
                                if choices:
                                    delta = choices[0].get("delta", {})

                                    # Reasoning / Thinking tokens (Qwen models)
                                    reasoning_chunk = delta.get("reasoning_content") or delta.get("thinking")
                                    if reasoning_chunk:
                                        yield json.dumps({"t": "thinking", "c": reasoning_chunk}) + "\n"

                                    # Standard response text
                                    content_chunk = delta.get("content")
                                    if content_chunk:
                                        yield json.dumps({"t": "text", "c": content_chunk}) + "\n"

                            except Exception:
                                pass
                return
            else:
                print(f"[LITELLM ERROR] Status {response.status_code}: {response.text}")

        except Exception as e:
            print(f"[LITELLM EXCEPTION] {e}")
            
    # 2. RUN OLLAMA FALLBACK
    source_used = f"Local Ollama ({app_state['OLLAMA_MODEL']})" + (" [Fallback]" if model_pref == 'cloud' else "")
    
    ollama_history = clean_history[-5:] if len(clean_history) > 5 else list(clean_history)
    if sys_inst:
        ollama_history.insert(0, {"role": "system", "content": sys_inst})

    try:
        ollama_payload = {"model": app_state['OLLAMA_MODEL'], "messages": ollama_history, "stream": True}
        
        ollama_images = [pf["base64"] for pf in processed_files if pf["mime_type"].startswith('image/')]
        if ollama_images: 
            ollama_payload["messages"][-1]["images"] = ollama_images
        
        if any(pf["mime_type"] == 'application/pdf' for pf in processed_files):
            yield json.dumps({"t": "text", "c": "\n*[Notice: Local Ollama models do not parse PDFs natively. Use Cloud mode.]*\n"}) + "\n"
        
        ollama_res = requests.post(app_state['OLLAMA_URL'], json=ollama_payload, stream=True)
        
        if ollama_res.status_code == 200:
            yield json.dumps({"t": "source", "c": source_used}) + "\n"
            for line in ollama_res.iter_lines():
                if line:
                    data = json.loads(line.decode('utf-8'))
                    msg = data.get('message', {})
                    if msg.get('thinking'): yield json.dumps({"t": "thinking", "c": msg.get('thinking')}) + "\n"
                    if msg.get('content'): yield json.dumps({"t": "text", "c": msg.get('content')}) + "\n"
        else:
            yield json.dumps({"t": "text", "c": f"Ollama Error: {ollama_res.status_code}"}) + "\n"
    except Exception as e:
        yield json.dumps({"t": "text", "c": f"Connection lost: {str(e)}"}) + "\n"