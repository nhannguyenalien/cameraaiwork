"""RunPod Serverless jobs that stay off the live alert path."""
import math
import os


def _normalized(values, field):
    if not isinstance(values, list) or not values:
        raise ValueError(f"{field} must be a non-empty number array")
    vector = [float(value) for value in values]
    norm = math.sqrt(sum(value * value for value in vector))
    if not math.isfinite(norm) or norm == 0:
        raise ValueError(f"{field} must have a finite, non-zero norm")
    return [value / norm for value in vector]


def face_search(job_input):
    """Rank candidate face embeddings against a query by cosine similarity."""
    query = _normalized(job_input.get("queryEmbedding"), "queryEmbedding")
    candidates = job_input.get("candidates")
    if not isinstance(candidates, list) or len(candidates) > 10000:
        raise ValueError("candidates must be an array with at most 10000 items")
    limit = max(1, min(int(job_input.get("limit", 20)), 100))
    threshold = float(job_input.get("threshold", 0.5))
    matches = []
    for candidate in candidates:
        vector = _normalized(candidate.get("embedding"), "candidate.embedding")
        if len(vector) != len(query):
            raise ValueError("all embeddings must have the same dimensions")
        score = sum(left * right for left, right in zip(query, vector))
        if score >= threshold:
            matches.append({"id": str(candidate.get("id", "")), "score": round(score, 6)})
    matches.sort(key=lambda item: item["score"], reverse=True)
    return {"matches": matches[:limit], "searched": len(candidates)}


def handler(event):
    try:
        job_input = event.get("input") or {}
        if job_input.get("task") == "face_search":
            return face_search(job_input)
        return {"error": f"unknown task: {job_input.get('task')}"}
    except (TypeError, ValueError) as exc:
        return {"error": str(exc)}


if os.environ.get("RUNPOD_SERVERLESS") != "0":
    import runpod
    runpod.serverless.start({"handler": handler})
