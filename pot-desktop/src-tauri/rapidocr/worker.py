"""Private offline RapidOCR worker. JSONL stdin/stdout; never opens a server."""
import base64
import contextlib
import io
import json
import socket
import sys


def offline():
    def denied(*args, **kwargs):
        raise RuntimeError("RapidOCR 本地识别不允许网络连接。")
    socket.socket.connect = denied
    socket.socket.connect_ex = denied
    socket.create_connection = denied


def create_engine(threads=2):
    offline()
    with contextlib.redirect_stdout(sys.stderr):
        from rapidocr import RapidOCR
        return RapidOCR(params={
            "Global.log_level": "error",
            "Global.max_side_len": 2560,
            "Global.text_score": 0.0,
            "Det.limit_type": "max",
            "Det.limit_side_len": 1536,
            "Det.box_thresh": 0.4,
            "EngineConfig.onnxruntime.intra_op_num_threads": threads,
            "EngineConfig.onnxruntime.inter_op_num_threads": 1,
        })


def recognize(engine, request):
    encoded = request.get("image")
    if not isinstance(encoded, str) or not encoded or len(encoded) > 40_000_000:
        raise ValueError("图片数据无效或过大。")
    raw = base64.b64decode(encoded.split(",", 1)[-1], validate=True)
    with contextlib.redirect_stdout(sys.stderr):
        import numpy as np
        from PIL import Image
        with Image.open(io.BytesIO(raw)) as image:
            if image.width * image.height > 16_000_000:
                raise ValueError("图片过大，请缩小截图范围。")
            width, height = image.size
            image = np.asarray(image.convert("RGB"))[:, :, ::-1].copy()
        result = engine(image, use_cls=False)
    lines = []
    if result.txts is not None:
        for text, score, points in zip(result.txts, result.scores, result.boxes):
            if not text.strip():
                continue
            left, top = points.min(axis=0)
            right, bottom = points.max(axis=0)
            lines.append({"text": text, "confidence": float(score), "box": {
                "x": float(left), "y": float(top), "width": float(right-left), "height": float(bottom-top)}})
    return {"text": "\n".join(line["text"] for line in lines), "lines": lines, "width": width, "height": height}


def self_test():
    from PIL import Image, ImageDraw
    image = Image.new("RGB", (400, 90), "white")
    ImageDraw.Draw(image).text((15, 15), "Hello RapidOCR 123", fill="black", font_size=28)
    buffer = io.BytesIO(); image.save(buffer, format="PNG")
    result = recognize(create_engine(), {"image": base64.b64encode(buffer.getvalue()).decode("ascii")})
    if "123" not in result["text"] or not result["lines"]:
        raise RuntimeError("RapidOCR 离线识别自检失败。")


def reply(value):
    print(json.dumps(value, ensure_ascii=True), flush=True)


if __name__ == "__main__":
    offline()
    engine = None
    current_threads = None
    reply({"ready": True})
    for line in sys.stdin:
        try:
            request = json.loads(line)
            threads = request.get("threads", 2)
            if type(threads) is not int or threads not in (1, 2, 4, 8):
                raise ValueError("无效的 CPU 线程数。")
            if engine is None or current_threads != threads:
                engine = create_engine(threads)
                current_threads = threads
            reply({"result": recognize(engine, request)})
        except Exception:
            # Do not echo image bytes, paths or recognized private document text.
            reply({"error": "RapidOCR 本地识别失败，请检查图片或在文字识别设置中修复安装。"})
