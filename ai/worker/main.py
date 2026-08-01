"""
Local lightweight AI worker.

Runs on the same box as go2rtc (VPS Mac mini or wherever go2rtc lives). Only
called when go2rtc reports motion (see apps/web/src/services/detection.js) —
NOT on every frame — so it can stay a small/cheap model.

Currently a stub: `detect_person()` always returns False. Wire in a real
model before relying on it:
  - Apple Silicon: onnxruntime with the CoreMLExecutionProvider (uses the
    Neural Engine, near-zero CPU) running a YOLOv8n / MobileNet-SSD ONNX export.
  - Anything else: onnxruntime CPUExecutionProvider with the same model,
    slower but still fine at "a few times a minute" trigger rates.

Run: uvicorn main:app --host 0.0.0.0 --port 8001
"""

from fastapi import FastAPI, Request
from pydantic import BaseModel

app = FastAPI(title="camera-ai-worker")


class DetectResult(BaseModel):
    hasPerson: bool
    boxes: list = []


def detect_person(image_bytes: bytes) -> DetectResult:
    # TODO: replace with real inference, e.g.:
    #   session = onnxruntime.InferenceSession("model.onnx", providers=["CoreMLExecutionProvider"])
    #   ... preprocess image_bytes, run session, parse boxes for class "person" ...
    return DetectResult(hasPerson=False, boxes=[])


@app.post("/detect", response_model=DetectResult)
async def detect(request: Request):
    image_bytes = await request.body()
    return detect_person(image_bytes)


@app.get("/health")
async def health():
    return {"ok": True}
