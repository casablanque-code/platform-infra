CREATE TABLE IF NOT EXISTS deployment_outputs (
  id TEXT PRIMARY KEY,
  deployment_id TEXT NOT NULL,
  environment_id TEXT NOT NULL,
  output_key TEXT NOT NULL,
  output_value TEXT NOT NULL,
  created_at TEXT NOT NULL
);
