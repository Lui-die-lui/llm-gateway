import os

os.environ["AUDIT_DB"] = ":memory:"  # before app.main is imported
os.environ["POLICY_DB"] = ":memory:"

import pytest

from app import audit, company_policy

ENV_KEYS = [
    "UPSTREAM_MODE", "UPSTREAM_PROVIDER", "UPSTREAM_MODEL", "UPSTREAM_API_KEY", "UPSTREAM_BASE_URL",
    "INTERNAL_MODEL", "INTERNAL_BASE_URL", "LOCAL_LLM_MODEL", "RESPONSE_SCAN", "GATEWAY_ADMIN_TOKEN", "GATEWAY_API_KEYS", "SENSITIVE_KEYS",
]


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for k in ENV_KEYS:
        monkeypatch.delenv(k, raising=False)
    audit.configure(":memory:")
    company_policy.configure(":memory:")
