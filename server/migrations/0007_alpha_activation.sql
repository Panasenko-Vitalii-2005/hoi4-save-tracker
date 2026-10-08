-- Additive only. Do not backdate legacy ownership to an invented durable success.
ALTER TABLE analysis_ownership ADD COLUMN durable_acquired_at timestamptz;

ALTER TABLE product_events DROP CONSTRAINT product_events_event_name_check;
ALTER TABLE product_events ADD CONSTRAINT product_events_event_name_check CHECK (
  event_name IN ('analysis_upload_started', 'analysis_upload_rejected',
    'analysis_completed', 'analysis_failed', 'analysis_opened',
    'analysis_section_viewed', 'analysis_shared', 'shared_analysis_opened',
    'analysis_persisted', 'campaign_review_opened')
);

CREATE UNIQUE INDEX product_events_persisted_once_idx
  ON product_events(user_id, analysis_id)
  WHERE event_name = 'analysis_persisted' AND user_id IS NOT NULL AND analysis_id IS NOT NULL;

CREATE UNIQUE INDEX product_events_review_once_idx
  ON product_events(user_id, client_session_id, analysis_id,
    (properties->>'baseAnalysisId'), (properties->>'viewKind'),
    ((occurred_at AT TIME ZONE 'UTC')::date))
  WHERE event_name = 'campaign_review_opened';
