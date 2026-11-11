#!/usr/bin/env python3
"""Build the app, helper, GitHub catalog, and USB catalog."""
import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile
import zipfile


ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist"
APP_ID = "zekai_hud_restore"


def json_bytes(obj):
    return (json.dumps(obj, indent=2) + "\n").encode()


def add_file(archive, name, payload, mode=0o644):
    entry = tarfile.TarInfo(name)
    entry.size = len(payload)
    entry.mode = mode
    entry.uname = entry.gname = "root"
    archive.addfile(entry, io.BytesIO(payload))


def pack_helper(spec):
    component = dict(spec)
    component["files"] = []
    files = {}
    for entry in spec["files"]:
        payload = (ROOT / "helper" / entry["path"]).read_bytes()
        component["files"].append(dict(entry, sha256=hashlib.sha256(payload).hexdigest()))
        files["files/" + entry["path"]] = payload, int(entry["mode"], 8)
    for entry in spec["units"]:
        files["units/" + entry["name"]] = (ROOT / "helper" / entry["name"]).read_bytes(), 0o644
    package = DIST / (spec["id"] + "@" + spec["version"] + ".tgz")
    with package.open("wb") as stream:
        with gzip.GzipFile(filename="", fileobj=stream, mode="wb", mtime=0) as compressed:
            with tarfile.open(fileobj=compressed, mode="w") as archive:
                add_file(archive, "component.json", json_bytes(component))
                for name, (payload, mode) in sorted(files.items()):
                    add_file(archive, name, payload, mode)
    return package


def component(spec, package, repo):
    fields = ("id", "kind", "version", "title", "description", "mguHmi", "requires", "uninstallable")
    result = {key: spec[key] for key in fields}
    result["author"] = "ZEKAI Design"
    data = package.read_bytes()
    tag = APP_ID + "@" + spec["version"]
    url = f"https://github.com/{repo}/releases/download/{tag}/{package.name}" if repo else package.name
    result["artifact"] = {"name": package.name, "url": url, "size": len(data), "sha256": hashlib.sha256(data).hexdigest()}
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", default="ZEKAI-Design/ID7-HUD-Restore", help="GitHub owner/repository")
    repo = parser.parse_args().repo
    app = json.loads((ROOT / "apps" / APP_ID / "app.json").read_text())
    helper = json.loads((ROOT / "helper" / "component.json").read_text())
    if app["version"] != helper["version"]:
        raise ValueError("App and helper must share the release version")
    app.update(kind="app", requires={helper["id"]: helper["version"]}, uninstallable=True)
    subprocess.run([sys.executable, str(ROOT / "kit/tools/build.py"), "--omit-sdk", APP_ID], check=True)
    entries = [
        (helper, pack_helper(helper)),
        (app, DIST / (APP_ID + "@" + app["version"] + ".tgz")),
    ]
    for dest, source in [("catalog.json", repo), ("catalog.usb.json", None)]:
        (DIST / dest).write_bytes(json_bytes({
            "schema": 2, "name": "ZEKAI HUD Restore",
            "components": [component(spec, pkg, source) for spec, pkg in entries],
        }))
    with zipfile.ZipFile(DIST / f"ID7-HUD-Restore-{app['version']}-USB.zip", "w", zipfile.ZIP_DEFLATED) as bundle:
        base = "mgu-repo/id7-hud-restore/"
        bundle.write(DIST / "catalog.usb.json", base + "catalog.json")
        for _, pkg in entries:
            bundle.write(pkg, base + pkg.name)


if __name__ == "__main__":
    main()
