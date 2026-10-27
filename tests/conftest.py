import os

os.environ["AUDIT_DB"] = ":memory:"  # before app.main is imported

import pytest

from app import audit

ENV_KEYS = [
    "UPSTREAM_MODE", "UPSTREAM_PROVIDER", "UPSTREAM_MODEL", "UPSTREAM_API_KEY", "UPSTREAM_BASE_URL",
    "INTERNAL_MODEL", "INTERNAL_BASE_URL", "LOCAL_LLM_MODEL", "RESPONSE_SCAN", "GATEWAY_ADMIN_TOKEN",
]


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for k in ENV_KEYS:
        monkeypatch.delenv(k, raising=False)
    audit.configure(":memory:")
