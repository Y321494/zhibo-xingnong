"""腾讯云函数（SCF）入口：接收前端 POST，把报名邮件投递到团队邮箱。

部署要点见 server/README.md。环境变量与 mailer.py 一致：
MAIL_TO / SMTP_USER / SMTP_PASS / SMTP_HOST / SMTP_PORT。
"""
from __future__ import annotations

import base64
import json
import re

import mailer

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
}


def _reply(code: int, payload: dict) -> dict:
    return {"statusCode": code, "headers": CORS, "body": json.dumps(payload, ensure_ascii=False)}


def main_handler(event, context):
    method = (event.get("httpMethod") or event.get("requestContext", {}).get("httpMethod") or "").upper()
    if method == "OPTIONS":
        return {"statusCode": 204, "headers": CORS, "body": ""}
    if method != "POST":
        return _reply(405, {"ok": False, "error": "method not allowed"})

    raw = event.get("body") or ""
    if event.get("isBase64Encoded"):
        raw = base64.b64decode(raw).decode("utf-8")

    try:
        payload = json.loads(raw)
        subject = str(payload.get("subject", "")).strip()
        text = str(payload.get("text", ""))
        email = str(payload.get("email", "")).strip()
        if email and not re.match(r"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$", email):
            raise ValueError("候选人邮箱格式不合法")
        result = mailer.send(subject, text, reply_to=email)
    except Exception as exc:  # noqa: BLE001
        return _reply(500, {"ok": False, "error": str(exc)[:200]})

    return _reply(200, result)
