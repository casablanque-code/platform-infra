export type Environment = {
  id: string;
  name: string;
  provider: string;
  region: string;
  template: string;
  status: string;
  ttl_hours: number;
  created_at: string;
};

export type Deployment = {
  id: string;
  environment_id: string;
  environment_name: string;
  provider: string;
  status: string;
  retry_count: number;
  created_at: string;
  finished_at: string | null;
};

export type InfraNode = {
  id: string;
  environment_id: string;
  environment_name: string;
  provider: string;
  hostname: string | null;
  public_ip: string | null;
  agent_version: string | null;
  status: string;
  first_seen_at: string;
  last_seen_at: string;
};

export type DeploymentEvent = {
  id: string;
  type: string;
  message: string;
  created_at: string;
};

export type Action = {
  id: string;
  environment_id: string;
  environment_name: string;
  type: string;
  status: string;
  params: string | null;
  created_at: string;
  finished_at: string | null;
};

export type AuditEntry = {
  id: string;
  actor: string;
  actor_role: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  resource_name: string | null;
  meta: string | null;
  created_at: string;
};

export type ApiKey = {
  id: string;
  name: string;
  role: "admin" | "operator" | "viewer";
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  created_by: string;
};

export type EnvironmentOutput = {
  output_key: string;
  output_value: string;
};

export type TemplateInput = {
  key: string;
  label: string;
  type: "text" | "number" | "select";
  required?: boolean;
  default?: string | number;
  options?: string[];
};

export type PlatformTemplate = {
  id: string;
  name: string;
  description: string;
  category: string;
  providers: string[];
  default_region: string;
  default_ttl_hours: number;
  inputs?: TemplateInput[];
};

export type Tab = "dashboard" | "environments" | "deployments" | "nodes" | "create" | "keys" | "audit";
