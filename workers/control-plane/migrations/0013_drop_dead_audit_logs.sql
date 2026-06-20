-- audit_logs (plural) was created in 0001_initial.sql but never written to --
-- 0011_audit_expiry.sql created audit_log (singular) as the real table and
-- said as much in its own comment. Dropping the dead duplicate so it can't
-- be confused for the live one in future migrations or manual queries.
DROP TABLE IF EXISTS audit_logs;
