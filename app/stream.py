"""Streaming response filter: scan, then restore, without leaking half a value across chunk boundaries.

Text is released only up to the last whitespace; the unfinished trailing token (which may be half of a
"[이메일_1]" placeholder or half of an email address) is held until more text or the end arrives.
"""
import re

from .detector import Match
from .sanitizer import scan_text
from .vault import Vault

MAX_HOLD = 200  # a token this long without whitespace is released anyway
_LAST_WS = re.compile(r"\s\S*$")


class StreamFilter:
    def __init__(self, vault: Vault, scan: bool) -> None:
        self.vault = vault
        self.scan = scan
        self.matches: list[Match] = []  # response-side findings, for the audit log
        self._buf = ""

    def feed(self, text: str) -> str:
        self._buf += text
        m = _LAST_WS.search(self._buf)
        cut = m.start() + 1 if m else 0
        if len(self._buf) - cut > MAX_HOLD:
            cut = len(self._buf)
        release, self._buf = self._buf[:cut], self._buf[cut:]
        return self._process(release)

    def flush(self) -> str:
        release, self._buf = self._buf, ""
        return self._process(release)

    def _process(self, text: str) -> str:
        if not text:
            return ""
        if self.scan:
            text, ms = scan_text(text)  # may raise ResponseBlocked
            self.matches += ms
        return self.vault.restore(text)
