"""First-run installer. Every download is pinned by SHA256 in runtime-lock.json."""
import contextlib
import hashlib
import importlib
import json
import os
from pathlib import Path
import shutil
import site
import subprocess
import sys
import time
import traceback
import urllib.request
import zipfile

ROOT = Path(sys.argv[1]).resolve()
LOCK = json.loads((ROOT / "runtime-lock.json").read_text(encoding="utf-8"))
DOWNLOADS = ROOT / "downloads"
DOWNLOADS.mkdir(parents=True, exist_ok=True)


def progress(detail, percent=0):
    print(json.dumps({"detail": detail, "percent": round(percent)}, ensure_ascii=True), flush=True)


def digest(path):
    with path.open("rb") as f:
        return hashlib.file_digest(f, "sha256").hexdigest()


def download(item):
    path = DOWNLOADS / item["filename"]
    if path.exists() and digest(path) == item["sha256"]:
        return path
    partial = path.with_suffix(path.suffix + ".part")
    progress("下载 " + item["filename"])
    with urllib.request.urlopen(item["url"], timeout=90) as response, partial.open("wb") as output:
        total = int(response.headers.get("Content-Length", 0))
        size, updated = 0, 0
        while block := response.read(1024 * 1024):
            output.write(block)
            size += len(block)
            if time.monotonic() - updated > 0.3:
                progress("下载 " + item["filename"], size / total * 100 if total else 0)
                updated = time.monotonic()
    if digest(partial) != item["sha256"]:
        partial.unlink(missing_ok=True)
        raise RuntimeError("下载校验失败：" + item["filename"])
    partial.replace(path)
    return path


def main():
    site_packages = ROOT / "runtime/Lib/site-packages"
    for item in LOCK["tools"]:
        wheel = download(item)
        with zipfile.ZipFile(wheel) as archive:
            # Locked official wheels only. Reject paths outside the target.
            for name in archive.namelist():
                if not (site_packages / name).resolve().is_relative_to(site_packages.resolve()):
                    raise RuntimeError("运行环境文件路径无效。")
            archive.extractall(site_packages)
    packages = [download(item) for item in LOCK["packages"]]
    progress("安装 LibreTranslate 及依赖（此阶段可能需要几分钟）")
    with (ROOT / "installation.log").open("w", encoding="utf-8") as log:
        subprocess.run([sys.executable, "-m", "pip", "install", "--no-index", "--no-deps", "--no-build-isolation", "--disable-pip-version-check", "--no-warn-script-location", *map(str, packages)], stdout=log, stderr=log, check=True)
    # Embedded Python omits non-existent site directories at process startup.
    if str(site_packages) not in sys.path:
        sys.path.insert(0, str(site_packages))
    importlib.invalidate_caches()
    site.addsitedir(str(site_packages))
    # Import our worker only after dependency installation.
    sys.path.insert(0, str(ROOT))
    from worker import configure, create_client, translate
    configure(ROOT)
    with contextlib.redirect_stdout(sys.stderr):
        from argostranslate import package
    for item in LOCK["models"]:
        asset = download(item)
        if item["kind"] == "translation":
            progress("安装 " + item["filename"])
            with contextlib.redirect_stdout(sys.stderr):
                package.install_from_path(asset)
        else:
            directory = ROOT / "data/argos-translate/minisbd"
            directory.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(asset, directory / item["filename"])
    progress("离线验证中译英和英译中")
    client = create_client(ROOT)  # This disables network before model loading.
    for text, source, target in [("Hello world.", "en", "zh"), ("你好，世界。", "zh", "en")]:
        if not translate(client, {"text": text, "source": source, "target": target}).strip():
            raise RuntimeError("离线翻译自检失败。")
    (ROOT / "installed.json").write_text(json.dumps({"id": LOCK["id"], "version": LOCK["version"], "pairs": ["zh-en", "en-zh"]}), encoding="utf-8")
    progress("离线引擎已就绪", 100)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        with (ROOT / "installation.log").open("a", encoding="utf-8") as log:
            traceback.print_exc(file=log)
        progress("安装失败，可重试。" + (str(error) if isinstance(error, RuntimeError) else "请检查网络、磁盘空间及 installation.log。"))
        sys.exit(1)
