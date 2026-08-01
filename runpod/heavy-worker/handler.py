"""
RunPod Serverless handler for heavy, occasional GPU tasks — NOT on the
live-alert path (that stays local in ai/worker, see its README for why).

Examples of what belongs here: face recognition/re-id search across stored
clips, generating a highlight-reel video, upscaling/enhancing a clip, batch
re-running a bigger detection model over historical footage.

Deploy: build this directory as a RunPod Serverless endpoint (see Dockerfile),
then call it via POST /api/jobs — see apps/pages/functions/api/jobs/index.js.
"""

import runpod


def handler(event):
    job_input = event.get("input", {})
    task = job_input.get("task")

    if task == "face_search":
        # TODO: load a face embedding model onto GPU, compare against stored
        # embeddings, return matches.
        return {"error": "face_search not implemented yet"}

    if task == "highlight_reel":
        # TODO: pull a set of clip URLs from job_input, stitch/encode on GPU.
        return {"error": "highlight_reel not implemented yet"}

    return {"error": f"unknown task: {task}"}


runpod.serverless.start({"handler": handler})
