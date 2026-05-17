CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  environment_id TEXT NOT NULL,
  environment_name TEXT NOT NULL,
  provider TEXT NOT NULL,
  hostname TEXT,
  public_ip TEXT,
  agent_version TEXT,
  status TEXT NOT NULL DEFAULT 'online',
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  FOREIGN KEY (environment_id) REFERENCES environments(id)
);

CREATE INDEX IF NOT EXISTS idx_nodes_environment_id ON nodes(environment_id);
CREATE INDEX IF NOT EXISTS idx_nodes_status ON nodes(status);
