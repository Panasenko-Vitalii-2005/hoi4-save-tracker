CREATE TABLE analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_hash text NOT NULL UNIQUE CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  file_size_bytes bigint NOT NULL CHECK (file_size_bytes > 0),
  parse_duration_ms integer NOT NULL CHECK (parse_duration_ms >= 0),
  division_count integer NOT NULL CHECK (division_count >= 0),
  save_format text NOT NULL CHECK (save_format IN ('plain_text', 'zip_text')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE product_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name text NOT NULL CHECK (
    event_name IN (
      'analysis_upload_started',
      'analysis_upload_rejected',
      'analysis_completed',
      'analysis_failed'
    )
  ),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  analysis_id uuid REFERENCES analyses(id) ON DELETE SET NULL,
  flow_id uuid,
  session_id uuid REFERENCES sessions(id) ON DELETE SET NULL,
  properties jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(properties) = 'object')
);

CREATE INDEX product_events_name_occurred_idx
  ON product_events(event_name, occurred_at DESC);

CREATE INDEX product_events_user_occurred_idx
  ON product_events(user_id, occurred_at DESC);

CREATE INDEX product_events_analysis_occurred_idx
  ON product_events(analysis_id, occurred_at DESC);

CREATE INDEX product_events_flow_idx
  ON product_events(flow_id);
