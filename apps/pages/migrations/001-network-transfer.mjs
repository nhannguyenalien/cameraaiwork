// Run before deploying either worker. Exact search deliberately avoids approximate
// indexes: preserve account isolation and the existing cosine threshold.
export const statements = [
  `CREATE EXTENSION IF NOT EXISTS vector`,
  `CREATE OR REPLACE FUNCTION camera_embedding(value text) RETURNS vector
   LANGUAGE plpgsql IMMUTABLE STRICT AS $$
   DECLARE v vector;
   BEGIN
     v := value::vector;
     IF vector_norm(v) = 0 THEN RETURN NULL; END IF;
     RETURN v;
   EXCEPTION WHEN OTHERS THEN RETURN NULL;
   END $$`,
  ...['people', 'gpu_people'].map(table => `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS embedding_vector vector GENERATED ALWAYS AS (camera_embedding(embedding)) STORED`),
  ...['people', 'gpu_people'].map(table => `CREATE INDEX IF NOT EXISTS ${table}_account_seen_idx ON ${table} (account_id, last_seen_at DESC, id DESC)`),
  `CREATE OR REPLACE FUNCTION camera_match_person(p_account text, p_embedding text, p_source text, p_threshold double precision, p_id text, p_increment boolean)
   RETURNS TABLE(id text, score double precision) LANGUAGE plpgsql AS $$
   DECLARE target text; candidate vector; matched_id text; matched_score double precision;
   BEGIN
     IF p_source NOT IN ('local','gpu') THEN RAISE EXCEPTION 'Invalid face source'; END IF;
     candidate := camera_embedding(p_embedding);
     IF candidate IS NULL THEN RETURN; END IF;
     target := CASE WHEN p_source = 'gpu' THEN 'gpu_people' ELSE 'people' END;
     -- Serialize matching + insertion for the same account/model to prevent duplicate clusters.
     PERFORM pg_advisory_xact_lock(hashtextextended(p_account || ':' || target, 0));
     EXECUTE format('SELECT id, 1 - (embedding_vector <=> $1) FROM %I
       WHERE account_id = $2 AND CASE WHEN vector_dims(embedding_vector) = vector_dims($1)
       THEN true ELSE false END ORDER BY embedding_vector <=> $1, id LIMIT 1', target)
       INTO matched_id, matched_score USING candidate, p_account;
     IF matched_id IS NOT NULL AND matched_score >= p_threshold THEN
       IF p_increment THEN
         EXECUTE format('UPDATE %I SET last_seen_at=CURRENT_TIMESTAMP, seen_count=seen_count+1 WHERE id=$1 AND account_id=$2', target) USING matched_id, p_account;
       END IF;
       RETURN QUERY SELECT matched_id, matched_score;
     ELSE
       EXECUTE format('INSERT INTO %I (id, account_id, embedding) VALUES ($1,$2,$3)', target) USING p_id, p_account, p_embedding;
       RETURN QUERY SELECT p_id, NULL::double precision;
     END IF;
   END $$`,
];
