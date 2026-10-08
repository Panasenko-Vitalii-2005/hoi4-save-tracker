-- Additive discovery metadata; existing ownership, artifacts and Recent data stay intact.
ALTER TABLE analysis_ownership
  ADD COLUMN history_metadata jsonb
    CHECK (history_metadata IS NULL OR
      (jsonb_typeof(history_metadata) = 'object' AND
       octet_length(history_metadata::text) <= 4096));

CREATE INDEX analysis_ownership_user_history_page_idx
  ON analysis_ownership(user_id, analyzed_at DESC, analysis_hash ASC);
