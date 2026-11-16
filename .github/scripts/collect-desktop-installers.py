"""Collect the requested platform's complete installer set from a Tauri build."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import tarfile
import zipfile


REQUIRED = {
    "linux-x86_64": (".AppImage", ".deb", ".rpm"),
    "windows-x86_64": (".exe", ".msi"),
    "macos-aarch64": (".dmg", ".app.tar.gz"),
    "macos-x86_64": (".dmg", ".app.tar.gz"),
}


def collect(root: Path, platform: str, target: str = "") -> str:
    version = json.loads((root / "apps/desktop/package.json").read_text(encoding="utf-8"))["version"]
    release = root / "target" / target / "release"
    bundle = release / "bundle"
    files = sorted(p for p in bundle.rglob("*") if p.is_file() and not p.is_symlink()
                   and p.name.endswith((".AppImage", ".deb", ".rpm", ".exe", ".msi",
                                        ".dmg", ".tar.gz", ".zip", ".sig")))
    for suffix in REQUIRED[platform]:
        if not any(p.name.endswith(suffix) for p in files):
            raise ValueError(f"Missing {platform} installer: {suffix}")
    if len({p.name for p in files}) != len(files):
        raise ValueError("Installer filenames must be unique within one platform")
    output = root / "desktop-installers"
    output.mkdir(exist_ok=False)
    for path in files:
        shutil.copy2(path, output / path.name)
    if platform == "windows-x86_64":
        with zipfile.ZipFile(output / f"cursor-byok-{version}-{platform}-portable.zip", "w",
                             compression=zipfile.ZIP_DEFLATED) as archive:
            archive.write(release / "cursor-byok-desktop.exe", "cursor-byok-desktop.exe")
    elif platform == "linux-x86_64":
        with tarfile.open(output / f"cursor-byok-{version}-{platform}-binary.tar.gz", "w:gz") as archive:
            archive.add(release / "cursor-byok-desktop", arcname="cursor-byok-desktop")
    manifest = {
        "version": version,
        "platform": platform,
        "commit": os.environ.get("GITHUB_SHA", "local"),
        "files": [{"name": p.name, "bytes": p.stat().st_size,
                   "sha256": hashlib.sha256(p.read_bytes()).hexdigest()}
                  for p in sorted(output.iterdir())],
    }
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    sums = "".join(f"{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.name}\n"
                   for p in sorted(output.iterdir()))
    (output / "SHA256SUMS.txt").write_text(sums, encoding="utf-8")
    print(f"Collected {len(manifest['files'])} packages for {platform} {version}")
    return version


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--platform", choices=REQUIRED, required=True)
    parser.add_argument("--target", default="")
    args = parser.parse_args()
    app_version = collect(Path.cwd(), args.platform, args.target)
    if path := os.environ.get("GITHUB_OUTPUT"):
        with open(path, "a", encoding="utf-8") as stream:
            stream.write(f"version={app_version}\n")
