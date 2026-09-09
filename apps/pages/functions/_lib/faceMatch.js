// Clusters face embeddings into "people" per account so the same person
// showing up in multiple events gets recognized as one — see the
// `people` table comment in schema.sql for the full picture.
//
// Threshold chosen from real testing against ai/worker's model
// (buffalo_s / w600k_mbf, ArcFace-style 512-dim embeddings): two
// different people in the same photo scored ~0.00 cosine similarity;
// the same face under a brightness+blur perturbation scored 0.92-0.97.
// Production camera frames are much harder than synthetic brightness/blur
// perturbations: the same person across pose, distance and compression has
// measured 0.35-0.49 cosine similarity. Keep this aligned with the relay's
// per-event de-duplication so repeated video frames stay one person.
export const SIMILARITY_THRESHOLD = 0.35;

import { getDb } from "./db.js";
import { randomId } from "./ids.js";

function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

// Returns the matched/created person's id, or null if no embedding was
// given (AI worker not deployed, or no face found in the frame).
export async function findOrCreatePerson(env, accountId, embedding) {
  if (!Array.isArray(embedding) || embedding.length === 0 || embedding.some((value) => !Number.isFinite(value))) return null;

  const db = getDb(env);
  const existing = await db.execute({
    sql: "SELECT id, embedding FROM people WHERE account_id = ?",
    args: [accountId],
  });

  let best = null;
  let bestScore = -1;
  for (const row of existing.rows) {
    let stored;
    try { stored = JSON.parse(row.embedding); } catch { continue; }
    if (!Array.isArray(stored) || stored.length !== embedding.length) continue;
    const score = cosineSimilarity(embedding, stored);
    if (score > bestScore) {
      bestScore = score;
      best = row;
    }
  }

  if (best && bestScore >= SIMILARITY_THRESHOLD) {
    await db.execute({
      sql: "UPDATE people SET last_seen_at = datetime('now','localtime'), seen_count = seen_count + 1 WHERE id = ?",
      args: [best.id],
    });
    return best.id;
  }

  const personId = randomId("person");
  await db.execute({
    sql: "INSERT INTO people (id, account_id, embedding) VALUES (?, ?, ?)",
    args: [personId, accountId, JSON.stringify(embedding)],
  });
  return personId;
}
