ALTER TABLE deployments
ADD COLUMN github_run_id TEXT;

ALTER TABLE deployments
ADD COLUMN last_checked_at TEXT;
