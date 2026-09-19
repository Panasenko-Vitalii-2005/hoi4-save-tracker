ALTER TABLE product_events
  DROP CONSTRAINT product_events_event_name_check;

ALTER TABLE product_events
  ADD CONSTRAINT product_events_event_name_check CHECK (
    event_name IN (
      'analysis_upload_started',
      'analysis_upload_rejected',
      'analysis_completed',
      'analysis_failed',
      'analysis_opened',
      'analysis_section_viewed',
      'analysis_shared',
      'shared_analysis_opened'
    )
  ),
  ADD COLUMN client_session_id uuid;

CREATE INDEX product_events_client_session_idx
  ON product_events(client_session_id, occurred_at DESC)
  WHERE client_session_id IS NOT NULL;

CREATE UNIQUE INDEX product_events_client_analysis_once_idx
  ON product_events(event_name, analysis_id, client_session_id)
  WHERE client_session_id IS NOT NULL
    AND analysis_id IS NOT NULL
    AND event_name IN (
      'analysis_opened',
      'analysis_shared',
      'shared_analysis_opened'
    );

CREATE UNIQUE INDEX product_events_client_section_once_idx
  ON product_events(
    event_name,
    analysis_id,
    client_session_id,
    (properties->>'section')
  )
  WHERE client_session_id IS NOT NULL
    AND analysis_id IS NOT NULL
    AND event_name = 'analysis_section_viewed';
