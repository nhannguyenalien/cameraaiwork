export function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers || {}) },
  });
}

export function errorJson(message, status = 400) {
  return json({ error: message }, { status });
}

// Wraps a handler so any thrown error (bad JSON, upstream fetch failure,
// DB error) becomes a structured JSON response instead of Cloudflare's
// generic error page — every route uses this.
export function withErrorHandling(handler) {
  return async (context) => {
    try {
      return await handler(context);
    } catch (err) {
      console.error(err);
      const status = Number.isInteger(err.status) ? err.status : 500;
      return errorJson(status < 500 ? (err.message || "Invalid request") : "Internal server error", status);
    }
  };
}
