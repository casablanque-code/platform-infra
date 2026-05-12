ALTER TABLE deployments
ADD COLUMN environment_name TEXT;

ALTER TABLE deployments
ADD COLUMN provider TEXT;