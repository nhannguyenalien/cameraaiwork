# ai/worker

Local, lightweight "does this frame have a person" service. Runs on-site
(same machine as go2rtc/apps/relay), reachable via that site's Cloudflare
Tunnel. Triggered by motion events, not run continuously — see
`apps/pages/functions/api/motion.js` and `apps/pages/functions/_lib/detection.js`
for the caller.

## Run

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8001
```

Then set `AI_WORKER_URL` in the Cloudflare Pages project's env vars to this
service's tunneled URL. If unset, every motion event is treated as an alert
(safe default).

## Status

Stub only — `detect_person()` in `main.py` needs a real model before this is
useful. See the TODO in that file for the recommended path (ONNX + CoreML
execution provider on Apple Silicon).

## When to use this vs. runpod/heavy-worker

- **This service**: cheap, fast, runs on every motion trigger, answers a
  yes/no question. Keep it here so alerts stay low-latency and don't cost
  GPU money for a binary classification.
- **runpod/heavy-worker**: anything that needs a bigger model or real GPU —
  face recognition/re-id across history, generating a highlight reel,
  upscaling a clip, batch re-analysis. Dispatch those as async jobs instead
  of blocking the alert path on them.
