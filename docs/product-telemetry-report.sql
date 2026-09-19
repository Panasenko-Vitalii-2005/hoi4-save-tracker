-- Private-alpha product report. Read-only: every statement is SELECT-only.
-- PostgreSQL timestamps are grouped in UTC explicitly for operator consistency.

-- 1. Successful analyses per UTC day.
SELECT
  date_trunc('day', occurred_at AT TIME ZONE 'UTC') AS utc_day,
  count(*) AS successful_analyses
FROM product_events
WHERE event_name = 'analysis_completed'
GROUP BY 1
ORDER BY 1;

-- 2a. Analysis attempts and terminal outcomes per UTC day.
SELECT
  date_trunc('day', occurred_at AT TIME ZONE 'UTC') AS utc_day,
  count(*) FILTER (WHERE event_name = 'analysis_upload_started') AS attempts,
  count(*) FILTER (WHERE event_name = 'analysis_completed') AS completed,
  count(*) FILTER (WHERE event_name = 'analysis_upload_rejected') AS rejected,
  count(*) FILTER (WHERE event_name = 'analysis_failed') AS failed,
  round(
    100.0 * count(*) FILTER (
      WHERE event_name IN ('analysis_upload_rejected', 'analysis_failed')
    ) / NULLIF(count(*) FILTER (
      WHERE event_name = 'analysis_upload_started'
    ), 0),
    2
  ) AS failure_or_rejection_percent
FROM product_events
WHERE event_name IN (
  'analysis_upload_started',
  'analysis_upload_rejected',
  'analysis_completed',
  'analysis_failed'
)
GROUP BY 1
ORDER BY 1;

-- 2b. Safe rejection/failure codes and stages.
SELECT
  event_name,
  properties->>'failureStage' AS failure_stage,
  properties->>'errorCode' AS error_code,
  count(*) AS events
FROM product_events
WHERE event_name IN ('analysis_upload_rejected', 'analysis_failed')
GROUP BY 1, 2, 3
ORDER BY events DESC, event_name, failure_stage, error_code;

-- 3. Canonical analyzed-save size, parse time and division distributions.
SELECT
  count(*) AS canonical_analyses,
  min(file_size_bytes) AS min_file_bytes,
  round(avg(file_size_bytes)) AS avg_file_bytes,
  percentile_cont(0.50) WITHIN GROUP (ORDER BY file_size_bytes) AS median_file_bytes,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY file_size_bytes) AS p95_file_bytes,
  min(parse_duration_ms) AS min_parse_ms,
  round(avg(parse_duration_ms)) AS avg_parse_ms,
  percentile_cont(0.50) WITHIN GROUP (ORDER BY parse_duration_ms) AS median_parse_ms,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY parse_duration_ms) AS p95_parse_ms,
  min(division_count) AS min_divisions,
  round(avg(division_count), 1) AS avg_divisions,
  max(division_count) AS max_divisions
FROM analyses;

-- 4. Registration-to-first-success activation.
WITH totals AS (
  SELECT count(*) AS registered_users FROM users
), activated AS (
  SELECT count(DISTINCT user_id) AS activated_users
  FROM product_events
  WHERE event_name = 'analysis_completed'
    AND user_id IS NOT NULL
)
SELECT
  totals.registered_users,
  activated.activated_users,
  round(
    100.0 * activated.activated_users / NULLIF(totals.registered_users, 0),
    2
  ) AS activation_percent
FROM totals CROSS JOIN activated;

-- 5a. Analysis opens and cross-session revisits.
WITH per_analysis AS (
  SELECT
    user_id,
    analysis_id,
    count(*) AS browser_sessions_opened
  FROM product_events
  WHERE event_name = 'analysis_opened'
    AND user_id IS NOT NULL
    AND analysis_id IS NOT NULL
  GROUP BY user_id, analysis_id
)
SELECT
  count(*) AS user_analysis_pairs_opened,
  count(*) FILTER (WHERE browser_sessions_opened > 1) AS revisited_pairs,
  sum(browser_sessions_opened) AS total_session_opens
FROM per_analysis;

-- 5b. Users returning to the same analysis on another UTC calendar day.
WITH daily_opens AS (
  SELECT
    user_id,
    analysis_id,
    count(DISTINCT (occurred_at AT TIME ZONE 'UTC')::date) AS utc_days_opened
  FROM product_events
  WHERE event_name = 'analysis_opened'
    AND user_id IS NOT NULL
    AND analysis_id IS NOT NULL
  GROUP BY user_id, analysis_id
)
SELECT
  count(*) FILTER (WHERE utc_days_opened > 1) AS cross_day_user_analysis_pairs,
  count(DISTINCT user_id) FILTER (WHERE utc_days_opened > 1) AS cross_day_users
FROM daily_opens;

-- 6. Authenticated analysis section usage relative to opened analyses/users.
WITH opened AS (
  SELECT
    count(DISTINCT analysis_id) AS analyses,
    count(DISTINCT user_id) AS users
  FROM product_events
  WHERE event_name = 'analysis_opened'
), section_usage AS (
  SELECT
    properties->>'section' AS section,
    count(DISTINCT analysis_id) AS analyses,
    count(DISTINCT user_id) AS users
  FROM product_events
  WHERE event_name = 'analysis_section_viewed'
  GROUP BY properties->>'section'
)
SELECT
  section_usage.section,
  section_usage.analyses AS unique_analyses,
  section_usage.users AS unique_users,
  round(100.0 * section_usage.analyses / NULLIF(opened.analyses, 0), 2)
    AS percent_of_opened_analyses,
  round(100.0 * section_usage.users / NULLIF(opened.users, 0), 2)
    AS percent_of_users_who_opened
FROM section_usage CROSS JOIN opened
ORDER BY unique_analyses DESC, section;

-- 7. Sharing and anonymous public-open usage.
SELECT
  count(*) FILTER (WHERE event_name = 'analysis_shared') AS share_activations,
  count(DISTINCT analysis_id) FILTER (
    WHERE event_name = 'analysis_shared'
  ) AS unique_analyses_shared,
  count(*) FILTER (
    WHERE event_name = 'shared_analysis_opened'
  ) AS public_browser_session_opens,
  count(DISTINCT analysis_id) FILTER (
    WHERE event_name = 'shared_analysis_opened'
  ) AS unique_shared_analyses_opened
FROM product_events
WHERE event_name IN ('analysis_shared', 'shared_analysis_opened');
