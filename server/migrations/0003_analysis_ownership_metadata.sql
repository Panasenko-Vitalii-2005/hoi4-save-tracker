ALTER TABLE analysis_ownership
  ADD COLUMN pinned boolean NOT NULL DEFAULT false,
  ADD COLUMN file_name text,
  ADD COLUMN analyzed_at timestamptz;

UPDATE analysis_ownership
SET analyzed_at = created_at
WHERE analyzed_at IS NULL;

ALTER TABLE analysis_ownership
  ALTER COLUMN analyzed_at SET NOT NULL,
  ALTER COLUMN analyzed_at SET DEFAULT now();

CREATE INDEX analysis_ownership_user_analyzed_idx
  ON analysis_ownership(user_id, analyzed_at DESC);
