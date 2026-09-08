"""
Local lightweight AI worker.

Runs on the same on-site box as go2rtc. Only called when go2rtc reports
motion (see apps/pages/functions/api/motion.js) — NOT on every frame — so
it can stay small/cheap models, CPU inference, no GPU needed:

  1. YOLOv8n (nano) — "is there a person in this frame at all". Exported
     once via the official ultralytics package:
       pip install ultralytics
       python3 -c "from ultralytics import YOLO; YOLO('yolov8n.pt').export(format='onnx', imgsz=640, opset=12)"

  2. If yes, insightface's buffalo_s face detector + recognizer — "which
     person is this" as a 512-dim embedding, so the backend
     (apps/pages/functions/api/motion.js) can cluster it against known
     people instead of just logging an anonymous "Person" event. Only the
     two models actually needed (detection + recognition, ~16MB) are
     kept — buffalo_s also ships a 3D landmark model (143MB!) and a
     gender/age model neither of which this needs; both are skipped via
     allowed_modules.

All models are committed directly (platform-independent ONNX) rather
than re-exported per machine — re-exporting needs the full
ultralytics/torch or insightface toolchains (~1GB+), which the deployed
worker itself does NOT need, only onnxruntime (+ opencv for insightface's
own pre/postprocessing, which is more battle-tested than reimplementing
SCRFD's anchor decoding by hand would be).

Run: uvicorn main:app --host 0.0.0.0 --port 8001
"""

import io
import os

import cv2
import numpy as np
import onnxruntime
from fastapi import FastAPI, Request
from insightface.app import FaceAnalysis
from PIL import Image
from pydantic import BaseModel, Field

app = FastAPI(title="camera-ai-worker")

MODELS_DIR = os.path.join(os.path.dirname(__file__), "models")
PERSON_MODEL_PATH = os.path.join(MODELS_DIR, "person_detection.onnx")
INPUT_SIZE = 640
PERSON_CLASS_ID = 0  # COCO class 0 = "person"
CONFIDENCE_THRESHOLD = 0.5
IOU_THRESHOLD = 0.45  # for de-duplicating overlapping boxes of the same person

_person_session = onnxruntime.InferenceSession(PERSON_MODEL_PATH, providers=["CPUExecutionProvider"])
_person_input_name = _person_session.get_inputs()[0].name

# insightface looks for <root>/models/<name>/*.onnx — MODELS_DIR here
# plays double duty as that root, with "cameraaiwork" standing in for
# what would normally be a downloaded pack name like "buffalo_s".
_face_app = FaceAnalysis(
    name="cameraaiwork",
    root=os.path.dirname(__file__),
    providers=["CPUExecutionProvider"],
    allowed_modules=["detection", "recognition"],
)
_face_app.prepare(ctx_id=0, det_size=(320, 320))  # motion snapshots are small crops, not full portraits


class DetectResult(BaseModel):
    hasPerson: bool
    boxes: list = Field(default_factory=list)  # [{x1,y1,x2,y2,confidence}, ...] in original image pixels, from YOLO
    faceEmbedding: list | None = None  # 512-dim, largest face found — for clustering "who is this"
    faceEmbeddings: list = Field(default_factory=list)  # every visible face, ordered largest first


def _preprocess_person(image: Image.Image):
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


def _detect_persons(image: Image.Image):
    input_tensor, scale_x, scale_y = _preprocess_person(image)

    # Output shape (1, 84, 8400): 4 box coords + 80 COCO class scores, per anchor.
    (output,) = _person_session.run(None, {_person_input_name: input_tensor})
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

    return _nms(boxes)


def _face_embeddings(image: Image.Image):
    # insightface/opencv work in BGR numpy arrays, not PIL images.
    bgr = cv2.cvtColor(np.asarray(image.convert("RGB")), cv2.COLOR_RGB2BGR)
    faces = _face_app.get(bgr)
    if not faces:
        return []
    faces = sorted(
        faces,
        key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]),
        reverse=True,
    )
    return [
        {
            "embedding": face.embedding.astype(float).tolist(),
            "box": [float(value) for value in face.bbox],
            "confidence": float(face.det_score),
        }
        for face in faces
    ]


def detect_person(image_bytes: bytes) -> DetectResult:
    image = Image.open(io.BytesIO(image_bytes))
    boxes = _detect_persons(image)
    has_person = len(boxes) > 0

    face_embeddings = _face_embeddings(image) if has_person else []
    # Keep the singular field during rollout so an older cloud backend can
    # still identify the most prominent face.
    face_embedding = face_embeddings[0]["embedding"] if face_embeddings else None
    return DetectResult(
        hasPerson=has_person,
        boxes=boxes,
        faceEmbedding=face_embedding,
        faceEmbeddings=face_embeddings,
    )


@app.post("/detect", response_model=DetectResult)
async def detect(request: Request):
    image_bytes = await request.body()
    return detect_person(image_bytes)


@app.get("/health")
async def health():
    return {"ok": True}
