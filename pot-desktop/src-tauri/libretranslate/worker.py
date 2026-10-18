"""Private JSONL worker for the pinned LibreTranslate package; no HTTP listener."""
import contextlib
import json
import os
from pathlib import Path
import socket
import sys


def configure(root):
    for key, folder in [("XDG_DATA_HOME", "data"), ("XDG_CACHE_HOME", "cache"), ("XDG_CONFIG_HOME", "config")]:
        os.environ[key] = str(root / folder)
    os.environ["ARGOS_PACKAGES_DIR"] = str(root / "packages")
    os.environ["ARGOS_DEVICE_TYPE"] = "cpu"
    os.environ["ARGOS_INTER_THREADS"] = "1"
    os.environ["ARGOS_INTRA_THREADS"] = "4"
    os.environ["PYTHONIOENCODING"] = "utf-8"


def deny_network(*args, **kwargs):
    raise RuntimeError("Offline engine: network access is disabled")


def create_client(root):
    configure(root)
    # Also block accidental lazy downloads during imports and first inference.
    socket.socket.connect = deny_network
    socket.socket.connect_ex = deny_network
    socket.create_connection = deny_network
    socket.getaddrinfo = deny_network
    with contextlib.redirect_stdout(sys.stderr):
        from argostranslate import package
        pairs = {(p.from_code, p.to_code) for p in package.get_installed_packages()}
        if not {("en", "zh"), ("zh", "en")} <= pairs:
            raise RuntimeError("中英模型不完整，请重新安装离线引擎。")
        from libretranslate.main import get_parser
        from libretranslate.app import create_app
        args = get_parser().parse_args(["--load-only", "en,zh", "--disable-files-translation", "--disable-web-ui"])
        args.update_models = False
        args.force_update_models = False
        app = create_app(args)
    return app.test_client()


def translate(client, request):
    source, target = request.get("source"), request.get("target")
    text = request.get("text")
    if (source, target) not in {("en", "zh"), ("zh", "en")}:
        raise ValueError("离线引擎仅支持中译英和英译中。")
    if not isinstance(text, str) or len(text) > 100_000:
        raise ValueError("原文无效或超过 100000 字符。")
    if not text.strip():
        return ""
    with contextlib.redirect_stdout(sys.stderr):
        response = client.post("/translate", json={"q": text, "source": source, "target": target, "format": "text"})
    data = response.get_json()
    if response.status_code != 200 or not isinstance(data, dict) or not isinstance(data.get("translatedText"), str):
        # Never echo submitted text or a provider error containing it.
        raise RuntimeError("LibreTranslate 本地推理失败，请检查离线引擎状态。")
    return data["translatedText"]


def reply(data):
    print(json.dumps(data, ensure_ascii=True), flush=True)


if __name__ == "__main__":
    root = Path(sys.argv[1]).resolve()
    try:
        client = create_client(root)
        reply({"ready": True})
        for line in sys.stdin:
            try:
                request = json.loads(line)
                reply({"text": translate(client, request)})
            except Exception:
                reply({"error": "本地翻译失败，请检查语言方向或重新安装离线引擎。"})
    except Exception:
        reply({"error": "无法加载离线引擎，请重新安装运行环境和中英模型。"})
        sys.exit(1)
