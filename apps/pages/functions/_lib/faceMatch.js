// Clusters face embeddings into "people" per account so the same person
// showing up in multiple events gets recognized as one — see the
// `people` table comment in schema.sql for the full picture.
//
// Threshold chosen from real testing against ai/worker's model
// (buffalo_s / w600k_mbf, ArcFace-style 512-dim embeddings): two
// different people in the same photo scored ~0.00 cosine similarity;
// the same face under a brightness+blur perturbation scored 0.92-0.97.
// Production camera frames are much harder than synthetic brightness/blur.
// Keep matching conservative because false merges are harder to correct than
// duplicate groups; an estimated headcount must not be used as ground truth.
// Keep this aligned with the relay's per-event de-duplication.
export const SIMILARITY_THRESHOLD = 0.30;

import { getDb } from "./db.js";
import { randomId } from "./ids.js";

export function validEmbedding(embedding) {
  return Array.isArray(embedding) && embedding.length > 0 && embedding.length <= 16000
    && embedding.every(Number.isFinite) && embedding.some(value => value !== 0);
}

// Matching and insertion are one database transaction, serialized per account/model.
// No embedding rows leave PostgreSQL. GPU and local models remain separate.
export async function findOrCreatePerson(env, accountId, embedding, source = "local", threshold = SIMILARITY_THRESHOLD, increment = true) {
  if (!validEmbedding(embedding)) return null;
  if (!["local", "gpu"].includes(source)) throw new Error("Invalid face source");
  if (!Number.isFinite(threshold) || threshold < -1 || threshold > 1) throw new Error("Invalid face threshold");
  const db = getDb(env, `face.${source}`);
  const result = await db.execute({
    sql: "SELECT id, score FROM camera_match_person(?, ?, ?, ?, ?, ?)",
    args: [accountId, JSON.stringify(embedding), source, threshold, randomId("person"), increment],
  });
  return result.rows[0]?.id || null;
}
