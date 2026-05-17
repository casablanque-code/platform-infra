CREATE TABLE IF NOT EXISTS actions (
  id TEXT PRIMARY KEY,
  environment_id TEXT NOT NULL,
  environment_name TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  params TEXT,
  github_run_id TEXT,
  created_at TEXT NOT NULL,
  finished_at TEXT,
  FOREIGN KEY (environment_id) REFERENCES environments(id)
);

CREATE INDEX IF NOT EXISTS idx_actions_environment_id ON actions(environment_id);
CREATE INDEX IF NOT EXISTS idx_actions_status ON actions(status);
