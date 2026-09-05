CREATE TABLE analysis_ownership (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  analysis_hash text NOT NULL CHECK (analysis_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, analysis_hash)
);

CREATE INDEX analysis_ownership_analysis_hash_idx
  ON analysis_ownership(analysis_hash);
