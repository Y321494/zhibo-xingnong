"""报名邮件的构建与投递（仅用标准库）。

环境变量：
  MAIL_TO     收件人，逗号分隔；默认两个团队邮箱
  SMTP_HOST   默认 smtp.qq.com
  SMTP_PORT   默认 465（SSL）
  SMTP_USER   发件邮箱，例如 xxxx@qq.com
  SMTP_PASS   SMTP 授权码（不是登录密码）；未设置时只做 dry-run，不真的发信
"""
from __future__ import annotations

import os
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formatdate, make_msgid

DEFAULT_TO = "2360618616@qq.com"


def recipients() -> list[str]:
    raw = os.environ.get("MAIL_TO") or DEFAULT_TO
    return [item.strip() for item in raw.split(",") if item.strip()]


def smtp_config() -> dict:
    return {
        "host": os.environ.get("SMTP_HOST", "smtp.qq.com"),
        "port": int(os.environ.get("SMTP_PORT", "465")),
        "user": os.environ.get("SMTP_USER", ""),
        "password": os.environ.get("SMTP_PASS", ""),
    }


def build_message(subject: str, text: str) -> EmailMessage:
    cfg = smtp_config()
    to = recipients()
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = cfg["user"] or "noreply@localhost"
    msg["To"] = ", ".join(to)
    msg["Date"] = formatdate(localtime=True)
    msg["Message-ID"] = make_msgid()
    msg.set_content(text)
    return msg


def send(subject: str, text: str, reply_to: str = "") -> dict:
    cfg = smtp_config()
    to = recipients()
    if not subject or len(subject) > 200:
        raise ValueError("subject 长度不合法")
    if not text or len(text) > 20000:
        raise ValueError("内容长度不合法")

    msg = build_message(subject, text)
    if reply_to:
        msg["Reply-To"] = reply_to

    if not cfg["password"]:
        return {
            "ok": True,
            "dryRun": True,
            "to": to,
            "subject": subject,
            "chars": len(text),
            "replyTo": reply_to,
        }

    context = ssl.create_default_context()
    with smtplib.SMTP_SSL(cfg["host"], cfg["port"], context=context, timeout=20) as server:
        server.login(cfg["user"], cfg["password"])
        server.send_message(msg, from_addr=cfg["user"], to_addrs=to)

    return {"ok": True, "dryRun": False, "to": to, "chars": len(text)}
