"""
Local lightweight AI worker.

Runs on the same on-site box as go2rtc. Only called when go2rtc reports
motion (see apps/pages/functions/api/motion.js) — NOT on every frame — so
it can stay a small/cheap model: YOLOv8n (nano), ONNX, CPU inference. At
"a few times a minute" trigger rates, CPU is fine; no GPU needed.

model.onnx was exported once via the official ultralytics package:
    pip install ultralytics
    python3 -c "from ultralytics import YOLO; YOLO('yolov8n.pt').export(format='onnx', imgsz=640, opset=12)"
Committed directly (12MB, platform-independent) rather than re-exported
per machine — re-exporting needs the full ultralytics/torch toolchain
(~1GB), which the deployed worker itself does NOT need, only onnxruntime.

Run: uvicorn main:app --host 0.0.0.0 --port 8001
"""

import io
import os

import numpy as np
import onnxruntime
from fastapi import FastAPI, Request
from PIL import Image
from pydantic import BaseModel

app = FastAPI(title="camera-ai-worker")

MODEL_PATH = os.path.join(os.path.dirname(__file__), "model.onnx")
INPUT_SIZE = 640
PERSON_CLASS_ID = 0  # COCO class 0 = "person"
CONFIDENCE_THRESHOLD = 0.5
IOU_THRESHOLD = 0.45  # for de-duplicating overlapping boxes of the same person

_session = onnxruntime.InferenceSession(MODEL_PATH, providers=["CPUExecutionProvider"])
_input_name = _session.get_inputs()[0].name


class DetectResult(BaseModel):
    hasPerson: bool
    boxes: list = []  # [{x1,y1,x2,y2,confidence}, ...] in original image pixels


def _preprocess(image: Image.Image):
    orig_w, orig_h = image.size
    resized = image.convert("RGB").resize((INPUT_SIZE, INPUT_SIZE))
    arr = np.asarray(resized, dtype=np.float32) / 255.0
    arr = arr.transpose(2, 0, 1)[None, :, :, :]  # HWC -> NCHW
    scale_x = orig_w / INPUT_SIZE
    scale_y = orig_h / INPUT_SIZE
    return arr, scale_x, scale_y


def _iou(a, b):
    x1 = max(a[0], b[0])
    y1 = max(a[1], b[1])
    x2 = min(a[2], b[2])
    y2 = min(a[3], b[3])
    inter = max(0, x2 - x1) * max(0, y2 - y1)
    area_a = (a[2] - a[0]) * (a[3] - a[1])
    area_b = (b[2] - b[0]) * (b[3] - b[1])
    union = area_a + area_b - inter
    return inter / union if union > 0 else 0


def _nms(boxes):
    boxes = sorted(boxes, key=lambda b: b["confidence"], reverse=True)
    kept = []
    for box in boxes:
        coords = (box["x1"], box["y1"], box["x2"], box["y2"])
        if all(_iou(coords, (k["x1"], k["y1"], k["x2"], k["y2"])) < IOU_THRESHOLD for k in kept):
            kept.append(box)
    return kept


def detect_person(image_bytes: bytes) -> DetectResult:
    image = Image.open(io.BytesIO(image_bytes))
    input_tensor, scale_x, scale_y = _preprocess(image)

    # Output shape (1, 84, 8400): 4 box coords + 80 COCO class scores, per anchor.
    (output,) = _session.run(None, {_input_name: input_tensor})
    predictions = output[0].T  # (8400, 84)

    boxes = []
    for pred in predictions:
        cx, cy, w, h = pred[:4]
        class_scores = pred[4:]
        person_score = float(class_scores[PERSON_CLASS_ID])
        if person_score < CONFIDENCE_THRESHOLD:
            continue
        boxes.append(
            {
                # float() — these come out as numpy.float32, which Pydantic
                # can't JSON-serialize (caught by actually hitting the HTTP
                # endpoint, not just calling the function directly).
                "x1": float((cx - w / 2) * scale_x),
                "y1": float((cy - h / 2) * scale_y),
                "x2": float((cx + w / 2) * scale_x),
                "y2": float((cy + h / 2) * scale_y),
                "confidence": person_score,
            }
        )

    boxes = _nms(boxes)
    return DetectResult(hasPerson=len(boxes) > 0, boxes=boxes)


@app.post("/detect", response_model=DetectResult)
async def detect(request: Request):
    image_bytes = await request.body()
    return detect_person(image_bytes)


@app.get("/health")
async def health():
    return {"ok": True}
