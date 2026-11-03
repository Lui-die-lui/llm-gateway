"""Slack notice through one incoming webhook (SLACK_WEBHOOK_URL).

What goes out is only what an admin needs to act on: the id, the kind of data, the site, the length asked for and the reason
the employee wrote. Never a prompt. The webhook address is a secret: it is read from the environment, never stored, never
logged and never shown (only its host name is). Sending never blocks or fails the request that caused it.
"""
import logging
import os
import threading
from urllib.parse import urlparse

import httpx

from . import settings

log = logging.getLogger("gateway.notify")
TIMEOUT = 5.0
LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}  # a plain http address is accepted only for a receiver on this machine (development, tests)


def _url() -> str:
    return settings.slack_url()  # the console value, else the SLACK_WEBHOOK_URL environment variable


def valid(url: str) -> bool:
    """https anywhere, or plain http to a receiver on this machine (development, tests)."""
    u = urlparse(url)
    return bool(u.hostname) and (u.scheme == "https" or (u.scheme == "http" and u.hostname in LOCAL_HOSTS))


def configured() -> bool:
    return valid(_url())


def host() -> str | None:
    return urlparse(_url()).hostname if configured() else None


def send(text: str) -> tuple[bool, str]:
    """-> (delivered, what to tell the admin). The message never contains the address."""
    if not configured():
        return False, "SLACK_WEBHOOK_URL이 설정되지 않았어요"
    try:
        r = httpx.post(_url(), json={"text": text}, timeout=TIMEOUT, follow_redirects=False)
    except httpx.HTTPError as e:
        log.warning("slack notice failed: %s", type(e).__name__)
        return False, f"Slack에 연결하지 못했어요 ({type(e).__name__})"
    if r.status_code == 200:
        return True, "Slack으로 보냈어요"
    log.warning("slack notice rejected: %s", r.status_code)
    return False, f"Slack이 거절했어요 ({r.status_code}) · 웹훅 주소를 확인해 주세요"


def send_later(text: str, switch: str = "notify_new_exception") -> None:
    """Fire and forget: a slow or down Slack must not slow the employee's request. `switch` is the setting that turns this kind of notice on or off."""
    if configured() and settings.values()[switch]:
        threading.Thread(target=send, args=(text,), daemon=True).start()


def new_exception_text(req: dict) -> str:
    console = os.getenv("GATEWAY_CONSOLE_URL", "").strip().rstrip("/")
    link = f"\n승인·반려: {console}/console/exceptions" if console.startswith(("http://", "https://")) else ""
    reason = " ".join(req["reason"].split())
    reason = reason if len(reason) <= 120 else reason[:119] + "…"
    return (
        f":inbox_tray: 새 예외 요청 {req['id']}\n"
        f"• 요청자: {req['requester']}\n• 항목: {req['entity'] or '—'}\n• 사이트: {req['site'] or '—'} · 기간: {req['scope']}\n"
        f"• 사유: {reason}{link}"
    )
