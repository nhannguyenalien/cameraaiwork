# ai/worker

Local, lightweight service that answers two questions per motion-triggered
frame: "is there a person" and, if so, "which person" (as a face
embedding for clustering). Runs on-site (same machine as go2rtc/apps/relay),
reachable via that site's Cloudflare Tunnel. Triggered by motion events,
not run continuously — see `apps/pages/functions/api/motion.js` and
`apps/pages/functions/_lib/detection.js` for the caller, and
`apps/pages/functions/_lib/faceMatch.js` for the clustering logic.

## Run

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8001
```

Then set `AI_WORKER_URL` in the Cloudflare Pages project's env vars to this
service's tunneled URL. If unset, every motion event is treated as an alert
with no face data (safe default).

## Status

Working, tested against a real live camera feed (not just sample images):

- **Person detection**: YOLOv8n (nano), ONNX, CPU inference.
- **Face embedding**: insightface's `buffalo_s` pack, but only the 2
  models actually needed — `det_500m` (face detection, 2.5MB) and
  `w600k_mbf` (ArcFace-style recognition, 13.6MB, 512-dim output) via
  `allowed_modules=["detection", "recognition"]`. Skips the pack's other
  two models (a 143MB 3D landmark model and a gender/age model) entirely.

All 3 ONNX files are committed directly (`models/person_detection.onnx`,
`models/cameraaiwork/face_detection.onnx`,
`models/cameraaiwork/face_recognition.onnx` — the nested `cameraaiwork/`
directory is insightface's own expected layout, not arbitrary) rather
than re-exported per machine — re-exporting needs the full
`ultralytics`/`torch` or `insightface`'s own download step, which the
deployed worker itself doesn't need. Re-export if you ever need to:

```bash
pip install ultralytics insightface
python3 -c "from ultralytics import YOLO; YOLO('yolov8n.pt').export(format='onnx', imgsz=640, opset=12)"
python3 -c "from insightface.app import FaceAnalysis; FaceAnalysis(name='buffalo_s').prepare(ctx_id=0)"
# then copy the relevant files from ~/.insightface/models/buffalo_s/
```

**Tested against real data, not just samples**: `ultralytics`' own
`bus.jpg` (4 people, correctly detected) and a blank image (correctly
zero) first, then a real live Tapo camera feed at an actual jewelry shop
— correctly detected a person with their face out of frame (overhead
camera angle) as `hasPerson: true, faceEmbedding: null`, and correctly
extracted a real embedding once a clear face came into frame. The
clustering logic (`faceMatch.js`) was verified against the real DB: the
same real embedding submitted twice returned the same `person_id`; a
different embedding returned a different one.

Threshold notes (from testing the recognition model, not the live
camera): two different people in the same photo scored ~0.00 cosine
similarity; the same face under a brightness+blur perturbation scored
0.92-0.97. `SIMILARITY_THRESHOLD = 0.5` in `faceMatch.js` sits well
inside that gap, but hasn't yet been tested against real day-to-day
variation (different days, lighting, angles) at scale — revisit if
false splits/merges show up in practice.

CPU inference only for now — switch `providers=["CPUExecutionProvider"]`
in `main.py` to `CoreMLExecutionProvider` if running on Apple Silicon and
CPU latency turns out to matter (untested — CPU has been fine so far at
the "a few times a minute" trigger rate this runs at).

## When to use this vs. runpod/heavy-worker

- **This service**: cheap, fast, runs on every motion trigger — person
  presence + face embedding extraction. Keep it here so alerts and
  clustering stay low-latency and don't cost GPU money for something
  this small.
- **runpod/heavy-worker**: anything that needs a bigger model or real
  GPU — generating a highlight reel, upscaling a clip, batch
  re-analysis of historical footage. Dispatch those as async jobs
  instead of blocking the alert path on them.
