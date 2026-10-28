"""Make a gateway API key.

    python -m app.keys hr-app            -> hr-app:gw_...   (add it to GATEWAY_API_KEYS, comma separated)

The part after the colon is what the app sends (Authorization: Bearer gw_... or X-Gateway-Key). The name before it is
only a label that shows up in the audit log. To revoke a key, delete its entry and redeploy; to rotate, add the new
one first, switch the app over, then delete the old one.
"""
import secrets
import sys


def new_entry(name: str) -> str:
    if not name or any(c in name for c in ",: \t"):
        raise ValueError("name must be non-empty and contain no comma, colon or space")
    return f"{name}:gw_{secrets.token_urlsafe(24)}"


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    try:
        print(new_entry(sys.argv[1]))
    except ValueError as e:
        sys.exit(str(e))
