# runpod/heavy-worker

Scaffold for offloading occasional GPU-heavy tasks to
[RunPod Serverless](https://docs.runpod.io/serverless/overview), kept
separate from the low-latency alert path (`ai/worker`).

## Deploy (once a task is actually implemented in `handler.py`)

1. Build & push the image: `docker build -t <registry>/cameraaiwork-heavy .`
2. Create a RunPod Serverless endpoint pointing at that image, pick a GPU
   tier sized for the task (cheapest that fits — this only runs on demand,
   RunPod bills per second while a job runs).
3. Copy the endpoint ID + your RunPod API key into the Cloudflare Pages
   project's env vars (`RUNPOD_ENDPOINT_ID`, `RUNPOD_API_KEY`).

## How it's called

`apps/pages/functions/api/jobs/index.js` (`POST /api/jobs`) submits:

```
POST https://api.runpod.ai/v2/{RUNPOD_ENDPOINT_ID}/run
Authorization: Bearer {RUNPOD_API_KEY}
{ "input": { "task": "face_search", ... } }
```

RunPod returns a job id immediately (async); the Pages Function stores it
(prefixed `runpod:`, tagged with the caller's account) in the `jobs` table
and returns `202` right away. Poll `GET /api/jobs/:id` for status — see
`docs/API.md`. Never block a request on a GPU job finishing.

## Why not run this locally on-site instead?

The on-site machines (Mac mini, mini PC, whatever a site uses) have no
discrete GPU worth mentioning for this class of model. RunPod gives
on-demand CUDA GPUs billed per second, which fits tasks that run rarely (a
few times a day/week) far better than provisioning a GPU box that sits
idle 99% of the time.
