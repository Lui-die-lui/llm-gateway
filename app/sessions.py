"""In-memory vault sessions for clients that sanitize and restore in separate calls (browser extension).

The proxy endpoint does not need this: its vault lives and dies inside one request.
Vaults here expire after TTL seconds of inactivity and are never written to disk or logs.
"""
import secrets
import time

from .vault import Vault

TTL = 30 * 60

_store: dict[str, tuple[Vault, float]] = {}


def create(vault: Vault) -> str:
    vault_id = secrets.token_urlsafe(16)
    _store[vault_id] = (vault, time.monotonic() + TTL)
    return vault_id


def get(vault_id: str) -> Vault | None:
    now = time.monotonic()
    for k in [k for k, (_, exp) in _store.items() if exp < now]:
        del _store[k]
    entry = _store.get(vault_id)
    if entry is None:
        return None
    _store[vault_id] = (entry[0], now + TTL)  # sliding expiry
    return entry[0]
