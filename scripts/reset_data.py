"""Empty the gateway's stored data before a demo: python scripts/reset_data.py [--exceptions] [--audit] [--policy] [--yes]

Shows what would be deleted and deletes nothing unless --yes is given. Stop the gateway first (it keeps the files open);
it creates empty ones on the next start. The company policy (--policy) is only removed when you ask for it by name.
Paths follow the same variables as the server: EXCEPTIONS_DB, AUDIT_DB, POLICY_DB (default: data/*.db).
On a deployment the files live on the server's volume, so this has to run there, or the volume has to be emptied.
After that, scripts/seed_demo.py fills the audit log with fake traffic again.
"""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TARGETS = {
    "--exceptions": ("exception requests", os.getenv("EXCEPTIONS_DB", str(ROOT / "data" / "exceptions.db"))),
    "--audit": ("audit log", os.getenv("AUDIT_DB", str(ROOT / "data" / "audit.db"))),
    "--policy": ("company policy", os.getenv("POLICY_DB", str(ROOT / "data" / "policy.db"))),
}


def main(argv: list[str]) -> int:
    chosen = [f for f in TARGETS if f in argv] or ["--exceptions", "--audit"]
    go = "--yes" in argv
    for flag in chosen:
        name, path = TARGETS[flag]
        files = [Path(path + s) for s in ("", "-wal", "-shm", "-journal") if Path(path + s).exists()]
        if not files:
            print(f"{name}: nothing at {path}")
            continue
        for f in files:
            print(f"{'delete' if go else 'would delete'}: {f} ({f.stat().st_size} bytes)  [{name}]")
            if go:
                f.unlink()
    if not go:
        print("\nNothing was deleted. Add --yes to do it (stop the gateway first).")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
