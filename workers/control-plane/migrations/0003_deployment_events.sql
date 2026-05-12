CREATE TABLE IF NOT EXISTS deployment_events (
  id TEXT PRIMARY KEY,
  deployment_id TEXT NOT NULL,
  environment_id TEXT NOT NULL,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (deployment_id) REFERENCES deployments(id),
  FOREIGN KEY (environment_id) REFERENCES environments(id)
);
