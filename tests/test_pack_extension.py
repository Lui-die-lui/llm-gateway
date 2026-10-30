"""The extension package that goes to the Chrome Web Store: what is in it, and what stops it from being built."""
import importlib.util
import json
import shutil
import zipfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("pack_extension", ROOT / "scripts" / "pack_extension.py")
pack_extension = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pack_extension)


@pytest.fixture
def copy(tmp_path):
    dst = tmp_path / "extension"
    shutil.copytree(ROOT / "extension", dst)
    return dst


def test_the_real_extension_passes_every_check():
    assert pack_extension.check() == []


def test_the_zip_has_the_manifest_at_its_root_and_leaves_development_files_out(tmp_path):
    z = pack_extension.pack(out_dir=tmp_path)
    names = zipfile.ZipFile(z).namelist()
    assert "manifest.json" in names and "icons/icon128.png" in names and "content.js" in names
    assert not [n for n in names if n.startswith(("dev/", "test/")) or n.endswith(".md")]
    assert z.name == f"llm-gateway-guard-{json.loads((ROOT / 'extension' / 'manifest.json').read_text(encoding='utf-8'))['version']}.zip"


def test_building_twice_gives_the_same_bytes(tmp_path):
    a = pack_extension.pack(out_dir=tmp_path / "a").read_bytes()
    b = pack_extension.pack(out_dir=tmp_path / "b").read_bytes()
    assert a == b


@pytest.mark.parametrize(
    "edit,expected",
    [
        (lambda m: m.update(version="1.0.0-beta"), "version"),
        (lambda m: m.update(description="x" * 133), "description"),
        (lambda m: m["icons"].pop("128"), "icons.128 is missing"),
        (lambda m: m["background"].update(service_worker="gone.js"), "gone.js"),
        (lambda m: m["content_scripts"][0]["js"].append("missing.js"), "missing.js"),
    ],
)
def test_manifest_problems_stop_the_build(copy, edit, expected):
    path = copy / "manifest.json"
    manifest = json.loads(path.read_text(encoding="utf-8"))
    edit(manifest)
    path.write_text(json.dumps(manifest), encoding="utf-8")
    assert any(expected in p for p in pack_extension.check(copy))
    with pytest.raises(SystemExit):
        pack_extension.pack(copy, copy.parent / "out")


@pytest.mark.parametrize(
    "line,expected",
    [
        ('const key = "gw_abcdefghijklmnopqrstuvwxyz0123";', "access key"),
        ('const k = "sk-abcdefghijklmnopqrstuvwxyz123456";', "API key"),
        ("eval(userText);", "eval()"),
        ("const f = new Function('return 1');", "new Function()"),
    ],
)
def test_secrets_and_remote_code_stop_the_build(copy, line, expected):
    (copy / "lib.js").write_text((copy / "lib.js").read_text(encoding="utf-8") + "\n" + line + "\n", encoding="utf-8")
    assert any(expected in p for p in pack_extension.check(copy))


def test_a_remote_script_tag_and_a_broken_page_link_stop_the_build(copy):
    (copy / "popup.html").write_text(
        (copy / "popup.html").read_text(encoding="utf-8").replace("</body>", '<script src="https://cdn.example.com/x.js"></script><script src="nope.js"></script></body>'),
        encoding="utf-8",
    )
    problems = pack_extension.check(copy)
    assert any("internet" in p for p in problems) and any("nope.js" in p for p in problems)


def test_a_wrong_sized_icon_stops_the_build(copy):
    shutil.copy(copy / "icons" / "icon16.png", copy / "icons" / "icon128.png")
    assert any("128x128" in p for p in pack_extension.check(copy))
