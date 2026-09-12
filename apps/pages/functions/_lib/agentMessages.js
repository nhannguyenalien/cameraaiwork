import { getDb } from "./db.js";

const MAX_LIST_LIMIT = 200;
const MAX_CONTENT_LENGTH = 8000;

export async function saveAgentMessage(env, accountId, role, content, source = "chat") {
  const text = String(content || "").trim().slice(0, MAX_CONTENT_LENGTH);
  if (!text) return null;
  const db = getDb(env);
  const inserted = await db.execute({
    sql: "INSERT INTO agent_messages (account_id, role, content, source) VALUES (?, ?, ?, ?) RETURNING id, created_at",
    args: [accountId, role === "assistant" ? "assistant" : "user", text, source === "patrol" ? "patrol" : "chat"],
  });
  return inserted.rows[0] || null;
}

// `since` (an agent_messages.id) lets the dashboard poll for only what
// landed after its last render — e.g. a patrol digest that arrived while
// the tab was open — instead of re-fetching and re-rendering everything.
export async function listAgentMessages(env, accountId, { limit = 50, since = null } = {}) {
  const db = getDb(env);
  const cappedLimit = Math.max(1, Math.min(Number(limit) || 50, MAX_LIST_LIMIT));
  if (since) {
    const result = await db.execute({
      sql: "SELECT id, role, content, source, created_at FROM agent_messages WHERE account_id = ? AND id > ? ORDER BY id ASC LIMIT ?",
      args: [accountId, since, cappedLimit],
    });
    return result.rows;
  }
  const result = await db.execute({
    sql: "SELECT id, role, content, source, created_at FROM agent_messages WHERE account_id = ? ORDER BY id DESC LIMIT ?",
    args: [accountId, cappedLimit],
  });
  return result.rows.reverse();
}
