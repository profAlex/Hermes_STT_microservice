import json
import threading
import subprocess
import os
import sys
import time
import atexit
import urllib.request
import urllib.parse
import fcntl
import termios
from http.server import HTTPServer, BaseHTTPRequestHandler

LOG_PATH = "/tmp/voice_node.log"

def log(msg: str):
    """Запись логов исключительно в файл, чтобы не засорять stdout CLI."""
    with open(LOG_PATH, "a", encoding="utf-8") as f:
        f.write(f"{msg}\n")

log("\n=== [Voice Bridge] LOADING MODULE (Wayland HTTP Mode) ===")

HOST = "127.0.0.1"
PORT = 9999
NODE_TOGGLE_URL = "http://127.0.0.1:8086/toggle"

NODE_CLIENT_PATH = os.path.expanduser(
    "~/Documents/STT_TTS_microservice_localAI/hermes-voice-service/node-service/src/clients/cli-client.ts"
)

ts_process = None
is_recording = False


def send_toggle_to_node(action: str):
    """Передаём сигнал в запущенный Node.js процесс через STDIN или HTTP."""
    global ts_process
    
    if ts_process and ts_process.poll() is None:
        try:
            cmd = f"{action}\n"
            ts_process.stdin.write(cmd.encode('utf-8'))
            ts_process.stdin.flush()
            log(f"[Voice Bridge] Sent '{action}' to Node process STDIN")
            return
        except Exception as e:
            log(f"[Voice Bridge] STDIN Error: {e}")

    try:
        req = urllib.request.Request(
            NODE_TOGGLE_URL, 
            data=json.dumps({"action": action}).encode('utf-8'),
            headers={'Content-Type': 'application/json'}
        )
        with urllib.request.urlopen(req, timeout=1) as resp:
            pass
    except Exception:
        pass


def inject_text_into_prompt(text: str):
    """
    Эмулирует ввод текста с клавиатуры в активную строку CLI.
    """
    if not text:
        return

    # Способ 1: Имитация ввода через termios.TIOCSTI (работает для Linux sys.stdin)
    try:
        stdin_fd = sys.stdin.fileno()
        for char in text:
            fcntl.ioctl(stdin_fd, termios.TIOCSTI, char)
        log(f"[Voice Bridge] Injected {len(text)} chars via termios TIOCSTI")
        return
    except Exception as e:
        log(f"[Voice Bridge] TIOCSTI injection failed: {e}")

    # Способ 2: Запасной вариант для prompt_toolkit
    try:
        from prompt_toolkit.application import get_app
        app = get_app()
        if app and app.current_buffer:
            app.current_buffer.insert_text(text)
            app.invalidate()
            log(f"[Voice Bridge] Injected text via prompt_toolkit buffer")
            return
    except Exception as e:
        log(f"[Voice Bridge] prompt_toolkit injection failed: {e}")


def toggle_recording():
    global is_recording
    is_recording = not is_recording
    action = "start" if is_recording else "stop"
    
    log(f"[Hotkey Triggered]: action = {action}")
    send_toggle_to_node(action)


# ==========================================
# 1. HTTP Сервер для приёма сигналов и текста
# ==========================================
class VoiceInjectHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path == '/toggle':
            toggle_recording()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"status": "ok", "recording": is_recording}).encode('utf-8'))
            return

        if self.path == '/inject':
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            
            try:
                data = json.loads(post_data.decode('utf-8'))
                text_to_inject = data.get('text', '')
                
                if text_to_inject:
                    # Без sys.stdout.write! Эмулируем ввод в строку CLI
                    inject_text_into_prompt(text_to_inject)
                
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"status": "ok"}).encode('utf-8'))
                
            except Exception as e:
                log(f"[Voice Bridge] HTTP Handler error: {e}")
                self.send_response(500)
                self.end_headers()
                self.wfile.write(str(e).encode('utf-8'))
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        return


def start_http_server():
    try:
        server = HTTPServer((HOST, PORT), VoiceInjectHandler)
        server.serve_forever()
    except Exception as e:
        log(f"[Voice Bridge] HTTP Server error: {e}")


# ==========================================
# 2. Запуск фонового Node.js процесса
# ==========================================
def start_node_client():
    global ts_process
    
    log(f"Checking path: {NODE_CLIENT_PATH}")
    
    if not os.path.exists(NODE_CLIENT_PATH):
        log(f"ERROR: File not found at {NODE_CLIENT_PATH}")
        return

    env = os.environ.copy()
    env["GATEWAY_WS_URL"] = "ws://192.168.0.52:8085"
    env["INJECT_HTTP_URL"] = f"http://{HOST}:{PORT}/inject"

    try:
        log_file = open(LOG_PATH, "a", buffering=1)
        ts_process = subprocess.Popen(
            ["npx", "tsx", NODE_CLIENT_PATH],
            stdin=subprocess.PIPE,
            stdout=log_file,
            stderr=log_file,
            env=env,
            preexec_fn=os.setsid
        )
        log(f"✅ Фоновый Node-клиент запущен (PID: {ts_process.pid})")
    except Exception as e:
        log(f"ERROR launching process: {e}")


def cleanup():
    global ts_process
    if ts_process and ts_process.poll() is None:
        try:
            os.killpg(os.getpgid(ts_process.pid), 9)
            log("🛑 Фоновый Node-клиент остановлен.")
        except Exception:
            pass


# ==========================================
# 3. Инициализация
# ==========================================
def init_plugin():
    server_thread = threading.Thread(target=start_http_server, daemon=True)
    server_thread.start()
    
    start_node_client()
    atexit.register(cleanup)


init_plugin()

if __name__ == "__main__":
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        pass
