"""Build the zip that goes to the Chrome Web Store (or to someone who should load the extension).

    python scripts/pack_extension.py [output-folder]      default: dist/

Checks first, builds only if they pass: manifest fields the Store requires, every file the manifest and the pages point at is
in the package, icons have the right sizes, no real-looking key or secret is inside, no remotely hosted code or eval (Manifest V3
forbids both). Development-only files (dev/, test/, README) stay out of the zip.
"""
import hashlib
import json
import re
import struct
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "extension"
EXCLUDE_DIRS = {"dev", "test", "__pycache__"}
EXCLUDE_SUFFIXES = {".md"}
SECRETS = [
    (re.compile(r"gw_[A-Za-z0-9_-]{20,}"), "a gateway access key"),
    (re.compile(r"sk-(?:proj-)?[A-Za-z0-9_-]{20,}"), "an API key"),
    (re.compile(r"AKIA[0-9A-Z]{16}"), "an AWS key"),
]
CODE_RISKS = [
    (re.compile(r"\beval\s*\("), "eval()"),
    (re.compile(r"new\s+Function\s*\("), "new Function()"),
    (re.compile(r"<script[^>]+src=[\"']https?:", re.I), "a script loaded from the internet"),
    (re.compile(r"importScripts\(\s*[\"']https?:"), "importScripts from the internet"),
]


def package_files(src: Path) -> list[Path]:
    return sorted(
        p
        for p in src.rglob("*")
        if p.is_file() and not (set(p.relative_to(src).parts[:-1]) & EXCLUDE_DIRS) and p.suffix not in EXCLUDE_SUFFIXES
    )


def referenced(manifest: dict) -> set[str]:
    refs = set(manifest.get("icons", {}).values())
    refs |= set(manifest.get("action", {}).get("default_icon", {}).values())
    for key in ("default_popup",):
        if manifest.get("action", {}).get(key):
            refs.add(manifest["action"][key])
    if manifest.get("background", {}).get("service_worker"):
        refs.add(manifest["background"]["service_worker"])
    for cs in manifest.get("content_scripts", []):
        refs |= set(cs.get("js", [])) | set(cs.get("css", []))
    return refs


def png_size(path: Path) -> tuple[int, int] | None:
    data = path.read_bytes()[:24]
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    return struct.unpack(">II", data[16:24])


def check(src: Path = SRC) -> list[str]:
    problems: list[str] = []
    try:
        manifest = json.loads((src / "manifest.json").read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        return [f"manifest.json: {e}"]

    if manifest.get("manifest_version") != 3:
        problems.append("manifest_version must be 3")
    if not re.fullmatch(r"\d+(\.\d+){0,3}", str(manifest.get("version", ""))):
        problems.append(f"version {manifest.get('version')!r} is not 1 to 4 dot-separated numbers")
    if not 0 < len(manifest.get("name", "")) <= 75:
        problems.append("name must be 1-75 characters")
    if not 0 < len(manifest.get("description", "")) <= 132:
        problems.append("description must be 1-132 characters (it is the Store's short description)")

    files = package_files(src)
    names = {p.relative_to(src).as_posix() for p in files}
    for ref in sorted(referenced(manifest)):
        if ref not in names:
            problems.append(f"manifest points at {ref}, which is not in the package")
    for size in (16, 48, 128):
        icon = manifest.get("icons", {}).get(str(size))
        if not icon:
            problems.append(f"icons.{size} is missing")
        elif icon in names and png_size(src / icon) != (size, size):
            problems.append(f"{icon} is not a {size}x{size} PNG")

    for path in files:
        rel = path.relative_to(src).as_posix()
        if path.suffix in {".png", ".jpg", ".ico"}:
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        for rx, what in SECRETS:
            if rx.search(text):
                problems.append(f"{rel} contains what looks like {what}")
        for rx, what in CODE_RISKS:
            if rx.search(text):
                problems.append(f"{rel} uses {what} (not allowed in a Manifest V3 extension)")
        if path.suffix == ".html":  # local files the page loads
            for target in re.findall(r"""(?:src|href)=["']([^"'#?]+)["']""", text):
                if not re.match(r"[a-z]+:|//", target) and (path.parent / target).resolve().relative_to(src.resolve()).as_posix() not in names:
                    problems.append(f"{rel} loads {target}, which is not in the package")
    return problems


def pack(src: Path = SRC, out_dir: Path = ROOT / "dist") -> Path:
    problems = check(src)
    if problems:
        raise SystemExit("Not packed:\n  - " + "\n  - ".join(problems))
    version = json.loads((src / "manifest.json").read_text(encoding="utf-8"))["version"]
    out_dir.mkdir(parents=True, exist_ok=True)
    target = out_dir / f"llm-gateway-guard-{version}.zip"
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as z:
        for path in package_files(src):
            info = zipfile.ZipInfo(path.relative_to(src).as_posix(), date_time=(2026, 1, 1, 0, 0, 0))  # same bytes every time
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, path.read_bytes())
    return target


if __name__ == "__main__":
    zip_path = pack(out_dir=Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "dist")
    with zipfile.ZipFile(zip_path) as z:
        names = z.namelist()
    print(f"{zip_path} · {zip_path.stat().st_size / 1024:.0f} KB · {len(names)} files")
    print("sha256", hashlib.sha256(zip_path.read_bytes()).hexdigest())
    print("\n".join(f"  {n}" for n in names))
