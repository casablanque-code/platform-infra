-- reconcileStuckDeployments() reads item.original_status to decide whether a
-- permanently-failed deployment was a destroy job (-> mark environment
-- 'destroyed') or a provision job (-> mark environment 'failed'). That column
-- never existed, so the check was always undefined and destroy deployments
-- that hit max retries got mis-marked as 'failed' instead of 'destroyed'.
ALTER TABLE deployments ADD COLUMN original_status TEXT;
