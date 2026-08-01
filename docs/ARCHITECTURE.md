# Architecture

## Overview

```
[Tapo C200] --RTSP/ONVIF (LAN)--> [go2rtc, wherever it runs]
                                          |
                                 Cloudflare Tunnel (outbound only,
                                 no port forwarding at home)
                                          |
                                          v
                              [VPS Mac mini] --- Caddy (HTTPS reverse proxy)
                                          |
                     +--------------------+-------------------+
                     |                    |                   |
              [apps/web]           [ai/worker]          [data/*.db]
              Node/Express          Python, local        event metadata,
              orchestration,        lightweight person    clip links
              web UI, PTZ,          detector (triggered
              Telegram alerts       by motion, not
                     |              continuous)
                     |
                     +--> [runpod/heavy-worker] (Python, RunPod Serverless)
                          on-demand GPU for occasional heavy tasks
```

## Why this split

**Single camera, single household.** No message queue, no Kubernetes, no
microservice mesh — one Mac mini running a handful of supervised processes
is plenty. Complexity here should track actual load, not hypothetical scale.

**Motion-gated, not continuous.** The camera's own ONVIF motion event is the
trigger for everything downstream (snapshot → AI check → alert). Nothing
analyzes every frame of continuous video. This is the single biggest lever
for keeping the system light — it cuts CPU, GPU, and bandwidth costs by
orders of magnitude compared to always-on frame analysis.

**On-demand streaming.** go2rtc only needs to pull RTSP from the camera when
a browser actually opens the live view. Configure it so idle time (nobody
watching) costs ~nothing on the home upload link.

## Language choices

- **Node.js (`apps/web`)** — the orchestration/web layer: Express API, PTZ
  control, motion listener, Telegram alerts, static dashboard. Kept as
  plain JS (matching the original `server.js`) rather than converting to
  TypeScript now — the codebase is small enough that the migration wouldn't
  pay for itself yet. Worth reconsidering once this grows past a handful of
  files.
- **Python (`ai/worker`, `runpod/heavy-worker`)** — anything AI/ML. This
  isn't a stylistic choice: RunPod's SDK is Python-first, and essentially
  every relevant model ecosystem (ultralytics/YOLO, ONNX, face
  recognition libraries) ships Python APIs first and best. Fighting that by
  doing ML in Node would mean worse library support for no benefit.
- **Go (`go2rtc`)** — not code you write, a prebuilt binary you configure.
  Downloaded by `infra/setup.sh`, never committed (platform-specific,
  18MB+, and versioned upstream).

## Two-tier AI: local vs. RunPod

| | `ai/worker` | `runpod/heavy-worker` |
|---|---|---|
| Runs | Continuously available, called on every motion trigger | On-demand, only when explicitly invoked |
| Cost model | Free (uses hardware you already have) | Pay-per-second GPU |
| Latency budget | Must be fast (blocks the alert path) | Can take seconds–minutes |
| Example tasks | "Is there a person in this frame?" | Face search across history, highlight reel generation, clip upscaling, re-running a bigger model over old footage |

The Node backend calls `ai/worker` synchronously (with a timeout and a safe
fallback — see `apps/web/src/services/detection.js`), and calls
`runpod/heavy-worker` asynchronously as a fire-and-forget job (see
`apps/web/src/services/runpod.js`). Don't blur this line — pushing a
continuous/low-latency task onto RunPod means paying GPU-per-second for
something that should be nearly free, and pushing a heavy batch task onto
the local worker means blocking alerts on a slow job.

## Stability checklist

- `go2rtc` and `apps/web` both run under a process supervisor that
  auto-restarts on crash and on reboot (`infra/launchd/*.plist` for macOS;
  swap for systemd unit files if the box is Linux instead).
- `cloudflared` (or Tailscale) handles the home ↔ VPS link with automatic
  reconnect — no manual port forwarding to maintain.
- Caddy in front of the Node app for automatic HTTPS.
- Gate the public hostname with Cloudflare Access (free email-OTP) before
  anything else — this is a home camera, not something to leave open on
  the internet unauthenticated.

## Known issues carried over from the original code (see repo history)

- The original `go2rtc.yaml` and `server.js` disagreed on the camera's LAN
  IP (`192.168.2.23` vs `192.168.1.32`). Fixed here by making it a single
  `CAMERA_IP` env var — but double check it's actually correct for your
  network before deploying.
- Motion detection matched on raw substrings in the SSE payload
  (`data.includes('motion')`). Fine as a first pass; consider parsing the
  JSON properly if false positives show up.
