# runpod/heavy-worker

Scaffold for offloading occasional GPU-heavy tasks to
[RunPod Serverless](https://docs.runpod.io/serverless/overview), kept
separate from the low-latency alert path (`ai/worker`).

## Deploy (once a task is actually implemented in `handler.py`)

1. Build & push the image: `docker build -t <registry>/cameraaiwork-heavy .`
2. Create a RunPod Serverless endpoint pointing at that image, pick a GPU
   tier sized for the task (cheapest that fits — this only runs on demand,
   RunPod bills per second while a job runs).
3. Copy the endpoint ID + your RunPod API key into the web app's `.env`
   (`RUNPOD_ENDPOINT_ID`, `RUNPOD_API_KEY`).

## How the web app calls it

`apps/web/src/services/runpod.js` submits a job with:

```
POST https://api.runpod.ai/v2/{RUNPOD_ENDPOINT_ID}/run
Authorization: Bearer {RUNPOD_API_KEY}
{ "input": { "task": "face_search", ... } }
```

This returns a job id immediately (async) — poll
`GET /v2/{endpoint}/status/{id}` or configure a webhook. Don't block the
Express request/response cycle on a GPU job; kick it off, return 202, and
let the client poll `/history` or a dedicated job-status route.

## Why not run this locally on the Mac mini instead?

The Mac mini VPS has no discrete GPU worth mentioning for this class of
model. RunPod gives on-demand CUDA GPUs billed per second, which fits tasks
that run rarely (a few times a day/week) far better than provisioning a
GPU box that sits idle 99% of the time.
