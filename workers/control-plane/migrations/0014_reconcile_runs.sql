-- Reconciler: periodically compares D1's belief about what's running
-- against what Incus actually reports, since the control plane has no
-- direct network path to Incus (only the self-hosted runner does) and
-- three things can independently drift: D1 (desired/lifecycle state),
-- Terraform state (what was last applied), and Incus itself (physical
-- reality). This table stores each run's summary so the dashboard can
-- show "last checked" and surface drift without re-running the check.
CREATE TABLE IF NOT EXISTS reconcile_runs (
  id TEXT PRIMARY KEY,
  ran_at TEXT NOT NULL,
  incus_instance_count INTEGER NOT NULL,
  orphaned_in_incus TEXT NOT NULL,  -- JSON array: instances Incus has that D1 doesn't expect
  orphaned_in_d1 TEXT NOT NULL,     -- JSON array: environments D1 thinks are running that Incus doesn't have
  ok INTEGER NOT NULL              -- 1 if both arrays were empty, 0 otherwise
);

CREATE INDEX IF NOT EXISTS idx_reconcile_runs_ran_at ON reconcile_runs(ran_at DESC);
