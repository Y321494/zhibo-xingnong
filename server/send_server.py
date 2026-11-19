"""本地开发 / 局域网使用：同时托管静态页面并提供 POST /api/send。

用法（在仓库根目录）：
    python server/send_server.py            # 默认 http://127.0.0.1:8125

不配置 SMTP_PASS 时是 dry-run：不真的发信，把要发的内容写到 server/outbox/ 并打印摘要。
配置 SMTP_USER / SMTP_PASS 后才会真正投递到 MAIL_TO。
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
OUTBOX = HERE / "outbox"
sys.path.insert(0, str(HERE))

import mailer  # noqa: E402

MAX_BODY = 64 * 1024
RATE_WINDOW = 600          # 10 分钟
RATE_LIMIT = 6             # 每个 IP 每 10 分钟最多 6 次
_hits: dict[str, list[float]] = {}

ENV_FILE = HERE / ".env"


def load_env() -> None:
    """读取 server/.env（KEY=VALUE，# 开头为注释），已有环境变量优先。"""
    if not ENV_FILE.is_file():
        return
    for raw in ENV_FILE.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def rate_limited(ip: str) -> bool:
    now = time.time()
    stamps = [t for t in _hits.get(ip, []) if now - t < RATE_WINDOW]
    stamps.append(now)
    _hits[ip] = stamps
    return len(stamps) > RATE_LIMIT


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_POST(self):
        path = urlparse(self.path).path
        if path != "/api/send":
            self._json(404, {"ok": False, "error": "not found"})
            return

        ip = self.client_address[0]
        if rate_limited(ip):
            self._json(429, {"ok": False, "error": "提交太频繁，请稍后再试"})
            return

        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            self._json(413, {"ok": False, "error": "内容过大或为空"})
            return

        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            subject = str(payload.get("subject", "")).strip()
            text = str(payload.get("text", ""))
            email = str(payload.get("email", "")).strip()
            if email and not re.match(r"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$", email):
                raise ValueError("候选人邮箱格式不合法")
            result = mailer.send(subject, text, reply_to=email)
        except Exception as exc:  # noqa: BLE001
            self._json(500, {"ok": False, "error": str(exc)[:200]})
            return

        if result.get("dryRun"):
            OUTBOX.mkdir(exist_ok=True)
            name = time.strftime("%Y%m%d-%H%M%S") + "-" + str(abs(hash(subject)) % 10000) + ".txt"
            reply = result.get("replyTo") or ""
            header = f"To: {', '.join(result['to'])}\nSubject: {subject}\n"
            if reply:
                header += f"Reply-To: {reply}\n"
            (OUTBOX / name).write_text(header + "\n" + text, encoding="utf-8")
            print(f"[dry-run] 已保存 {name}，收件人 {', '.join(result['to'])}，{result['chars']} 字", flush=True)
        else:
            print(f"[sent] {subject} -> {', '.join(result['to'])}", flush=True)

        self._json(200, result)

    def _json(self, code: int, payload: dict):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if urlparse(self.path).path == "/favicon.ico":
            self.send_response(204)
            self.end_headers()
            return
        super().do_GET()

    def log_message(self, fmt, *args):
        try:
            message = fmt % args
        except Exception:  # noqa: BLE001
            message = str(fmt)
        if "/api/send" in message:
            print("[http]", message)


def main() -> None:
    load_env()
    port = int(os.environ.get("PORT", "8125"))
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    mode = "真实发信" if os.environ.get("SMTP_PASS") else "dry-run（未配置 SMTP_PASS）"
    print(f"serving {ROOT} at http://127.0.0.1:{port}/  发信模式：{mode}", flush=True)
    print(f"收件人：{', '.join(mailer.recipients())}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")


if __name__ == "__main__":
    main()
