import { Hono } from "hono";
import { cors } from "hono/cors";

type Env = {
  DB: D1Database;

  ASSETS: Fetcher;

  GITHUB_TOKEN: string;
  CALLBACK_TOKEN: string;

  GITHUB_OWNER: string;
  GITHUB_REPO: string;
  GITHUB_WORKFLOW: string;
  GITHUB_DESTROY_WORKFLOW: string;
  GITHUB_REF: string;
};

type TemplateInput = {
  key: string;
  label: string;
  type: "text" | "number" | "select";
  required?: boolean;
  default?: string | number;
  options?: string[];
};

type PlatformTemplate = {
  id: string;
  name: string;
  description: string;
  category: string;
  providers: string[];
  default_region: string;
  default_ttl_hours: number;

  inputs?: TemplateInput[];
};

type Node = {
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

const templates: PlatformTemplate[] = [
  {
    id: "docker-host",
    name: "Docker Host",
    description: "Ubuntu VM prepared for Docker workloads. Installs Docker CE + Compose on first boot.",
    category: "compute",
    providers: ["hetzner", "oracle", "aws", "azure", "gcp", "yandex"],
    default_region: "eu-central",
    default_ttl_hours: 72,
  },
  {
    id: "postgres",
    name: "PostgreSQL",
    description: "PostgreSQL instance provisioned and configured via infrastructure automation.",
    category: "database",
    providers: ["hetzner", "oracle", "aws", "azure", "gcp", "yandex"],
    default_region: "eu-central",
    default_ttl_hours: 72,
    inputs: [
      {
        key: "db_name",
        label: "Database name",
        type: "text",
        default: "app",
      },
      {
        key: "db_user",
        label: "Database user",
        type: "text",
        default: "postgres",
      },
    ],
  },
];

const app = new Hono<{ Bindings: Env }>();

app.use("*", cors());

function isAuthorized(authHeader: string | undefined, token: string) {
  if (!authHeader) return false;
  return authHeader === `Bearer ${token}`;
}

function findTemplate(id: string) {
  return templates.find((template) => template.id === id);
}

async function addDeploymentEvent(
  db: D1Database,
  deploymentId: string,
  environmentId: string,
  type: string,
  message: string
) {
  await db.prepare(`
    INSERT INTO deployment_events (
      id,
      deployment_id,
      environment_id,
      type,
      message,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `)
    .bind(
      crypto.randomUUID(),
      deploymentId,
      environmentId,
      type,
      message,
      new Date().toISOString()
    )
    .run();
}

app.get("/api/health", (c) => {
  return c.json({
    ok: true,
    service: "platform-control-plane",
  });
});

app.get("/api/templates", (c) => {
  return c.json(templates);
});

app.get("/api/environments", async (c) => {
  const result = await c.env.DB.prepare(`
    SELECT * FROM environments
    ORDER BY created_at DESC
  `).all();

  return c.json(result.results);
});

app.get("/api/deployments", async (c) => {
  const result = await c.env.DB.prepare(`
    SELECT * FROM deployments
    ORDER BY created_at DESC
  `).all();

  return c.json(result.results);
});

app.get("/api/deployments/:id/events", async (c) => {
  const id = c.req.param("id");

  const result = await c.env.DB.prepare(`
    SELECT *
    FROM deployment_events
    WHERE deployment_id = ?
    ORDER BY created_at ASC
  `)
    .bind(id)
    .all();

  return c.json(result.results);
});

app.get("/api/environments/:id/outputs", async (c) => {
  const id = c.req.param("id");

  const result = await c.env.DB.prepare(`
    SELECT
      output_key,
      output_value,
      created_at
    FROM deployment_outputs
    WHERE environment_id = ?
    ORDER BY created_at DESC
  `)
    .bind(id)
    .all();

  return c.json(result.results);
});

app.delete("/api/environments/:id", async (c) => {
  const id = c.req.param("id");

  const deployments = await c.env.DB.prepare(`
    SELECT id
    FROM deployments
    WHERE environment_id = ?
  `)
    .bind(id)
    .all();

  for (const deployment of deployments.results as any[]) {
    await c.env.DB.prepare(`
      DELETE FROM deployment_events
      WHERE deployment_id = ?
    `)
      .bind(deployment.id)
      .run();
  }

  await c.env.DB.prepare(`
    DELETE FROM deployment_outputs
    WHERE environment_id = ?
  `)
    .bind(id)
    .run();

  await c.env.DB.prepare(`
    DELETE FROM deployments
    WHERE environment_id = ?
  `)
    .bind(id)
    .run();

  await c.env.DB.prepare(`
    DELETE FROM environments
    WHERE id = ?
  `)
    .bind(id)
    .run();

  return c.json({
    ok: true,
    deleted_environment_id: id,
  });
});

app.post("/api/environments/:id/destroy", async (c) => {
  const id = c.req.param("id");

  const environment = await c.env.DB.prepare(`
    SELECT *
    FROM environments
    WHERE id = ?
  `)
    .bind(id)
    .first();

  if (!environment) {
    return c.json({
      error: "environment not found",
    }, 404);
  }

  const deploymentId = crypto.randomUUID();

  await c.env.DB.prepare(`
    INSERT INTO deployments (
      id,
      environment_id,
      environment_name,
      provider,
      status,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `)
    .bind(
      deploymentId,
      id,
      environment.name,
      environment.provider,
      "destroy_queued",
      new Date().toISOString()
    )
    .run();

  await c.env.DB.prepare(`
    UPDATE environments
    SET status = 'destroy_queued',
        updated_at = ?
    WHERE id = ?
  `)
    .bind(
      new Date().toISOString(),
      id
    )
    .run();

  await addDeploymentEvent(
    c.env.DB,
    deploymentId,
    id,
    "destroy_queued",
    "Destroy requested"
  );

  return c.json({
    ok: true,
    deployment_id: deploymentId,
    status: "destroy_queued",
  });
});

app.post("/api/environments", async (c) => {
  const body = await c.req.json<{
    name: string;
    provider: string;
    region: string;
    template: string;
    ttl_hours?: number;
    inputs?: Record<string, any>;
  }>();

  const template = findTemplate(body.template);

  if (!template) {
    return c.json({
      error: "unknown template",
      template: body.template,
    }, 400);
  }

  if (!template.providers.includes(body.provider)) {
    return c.json({
      error: "provider is not supported by template",
      template: body.template,
      provider: body.provider,
    }, 400);
  }

  const envId = crypto.randomUUID();
  const deploymentId = crypto.randomUUID();

  const now = new Date().toISOString();
  const ttlHours = body.ttl_hours ?? template.default_ttl_hours;

  await c.env.DB.prepare(`
    INSERT INTO environments (
      id,
      name,
      provider,
      region,
      template,
      status,
      ttl_hours,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
    .bind(
      envId,
      body.name,
      body.provider,
      body.region,
      body.template,
      "queued",
      ttlHours,
      now,
      now
    )
    .run();

  await c.env.DB.prepare(`
    INSERT INTO deployments (
      id,
      environment_id,
      environment_name,
      provider,
      status,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `)
    .bind(
      deploymentId,
      envId,
      body.name,
      body.provider,
      "queued",
      now
    )
    .run();

  await addDeploymentEvent(
    c.env.DB,
    deploymentId,
    envId,
    "queued",
    `Deployment queued by control plane using template ${template.id}`
  );

  return c.json({
    environment_id: envId,
    deployment_id: deploymentId,
    status: "queued",
  });
});

async function processDeploymentQueue(env: Env) {
  const candidate = await env.DB.prepare(`
    SELECT id, status
    FROM deployments
    WHERE status IN ('queued', 'destroy_queued')
AND (
  next_retry_at IS NULL
  OR next_retry_at <= ?
)
    ORDER BY created_at ASC
    LIMIT 1
`)
.bind(new Date().toISOString())
.first();

  if (!candidate) {
    return {
      ok: true,
      message: "no queued deployments",
    };
  }

  const deploymentId = candidate.id as string;
  const originalStatus = candidate.status as string;

  // попытка "захвата"
  const lock = await env.DB.prepare(`
    UPDATE deployments
    SET status = 'dispatching'
    WHERE id = ?
      AND status IN ('queued', 'destroy_queued')
  `).bind(deploymentId).run();

  if (lock.meta.changes === 0) {
    return {
      ok: true,
      message: "already taken by another worker",
    };
  }

  const deployment = await env.DB.prepare(`
    SELECT *
    FROM deployments
    WHERE id = ?
  `).bind(deploymentId).first();

  if (!deployment) {
    return {
      error: "deployment not found",
    };
  }

  const envId = deployment.environment_id as string;

  const environment = await env.DB.prepare(`
    SELECT *
    FROM environments
    WHERE id = ?
  `)
    .bind(envId)
    .first();

  if (!environment) {
    return {
      error: "environment not found",
    };
  }

  await env.DB.prepare(`
    UPDATE environments
    SET status = 'dispatching',
        updated_at = ?
    WHERE id = ?
  `)
    .bind(new Date().toISOString(), envId)
    .run();

  await addDeploymentEvent(
    env.DB,
    deploymentId,
    envId,
    "dispatching",
    "Dispatching GitHub Actions workflow"
  );

  await env.DB.prepare(`
    UPDATE deployments
    SET last_checked_at = ?
    WHERE id = ?
  `)
    .bind(new Date().toISOString(), deploymentId)
    .run();

  // ВАЖНО: используем originalStatus
  const workflow =
    originalStatus === "destroy_queued"
      ? env.GITHUB_DESTROY_WORKFLOW
      : env.GITHUB_WORKFLOW;

  const response = await fetch(
    `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/actions/workflows/${workflow}/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "platform-infra-control-plane",
      },
      body: JSON.stringify({
        ref: env.GITHUB_REF,
        inputs: {
          deployment_id: deploymentId,
          environment_id: envId,
          environment_name: environment.name,
          provider: environment.provider,
          region: environment.region,
          template: environment.template,
        },
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();

    await addDeploymentEvent(
      env.DB,
      deploymentId,
      envId,
      "dispatch_failed",
      errorText
    );

    return {
      error: "workflow dispatch failed",
      details: errorText,
    };
  }

  await addDeploymentEvent(
    env.DB,
    deploymentId,
    envId,
    "workflow_dispatched",
    "GitHub Actions workflow dispatched"
  );

  return {
    ok: true,
    deployment_id: deploymentId,
    status: "dispatching",
  };
}

async function reconcileExpiredEnvironments(env: Env) {
  const now = Date.now();

  const result = await env.DB.prepare(`
    SELECT *
    FROM environments
    WHERE status = 'running'
  `).all();

  for (const item of result.results as any[]) {
    const createdAt = new Date(item.created_at as string).getTime();
    const ttlHours = Number(item.ttl_hours ?? 72);

    const expiresAt = createdAt + ttlHours * 60 * 60 * 1000;

    if (now < expiresAt) {
      continue;
    }

    const existingDestroy = await env.DB.prepare(`
      SELECT id, status
      FROM deployments
      WHERE environment_id = ?
        AND status IN ('destroy_queued', 'dispatching')
      LIMIT 1
    `)
      .bind(item.id)
      .first();

    if (existingDestroy) {
      continue;
    }

    const deploymentId = crypto.randomUUID();
    const timestamp = new Date().toISOString();

    await env.DB.prepare(`
      INSERT INTO deployments (
        id,
        environment_id,
        environment_name,
        provider,
        status,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `)
      .bind(
        deploymentId,
        item.id,
        item.name,
        item.provider,
        "destroy_queued",
        timestamp
      )
      .run();

    await env.DB.prepare(`
      UPDATE environments
      SET status = 'destroy_queued',
          updated_at = ?
      WHERE id = ?
    `)
      .bind(timestamp, item.id)
      .run();

    await addDeploymentEvent(
      env.DB,
      deploymentId,
      item.id,
      "ttl_expired",
      `TTL expired after ${ttlHours} hours`
    );

    await addDeploymentEvent(
      env.DB,
      deploymentId,
      item.id,
      "destroy_queued",
      "Destroy queued by TTL controller"
    );
  }

  return {
    ok: true,
    checked: result.results.length,
  };
}

function getBackoffDelayMinutes(retry: number) {
  if (retry === 0) return 1;
  if (retry === 1) return 2;
  if (retry === 2) return 5;
  return 10;
}



async function reconcileStuckDeployments(env: Env) {
  const result = await env.DB.prepare(`
    SELECT *
    FROM deployments
    WHERE status = 'dispatching'
  `).all();

  const now = Date.now();
  const maxRetries = 3;

  for (const item of result.results as any[]) {
    const createdAt = new Date(
      item.created_at as string
    ).getTime();

    const ageMinutes =
      (now - createdAt) / 1000 / 60;

    if (ageMinutes < 5) {
      continue;
    }

    const retryCount = Number(item.retry_count ?? 0);

    if (retryCount >= maxRetries) {
      await env.DB.prepare(`
        UPDATE deployments
        SET status = 'failed_permanent'
        WHERE id = ?
      `)
        .bind(item.id)
        .run();

      await env.DB.prepare(`
        UPDATE environments
        SET status = 'failed',
            updated_at = ?
        WHERE id = ?
      `)
        .bind(new Date().toISOString(), item.environment_id)
        .run();

      await addDeploymentEvent(
        env.DB,
        item.id,
        item.environment_id,
        "failed_permanent",
        `Deployment exceeded max retries (${maxRetries})`
      );

      continue;
    }

    const nextRetryMinutes = getBackoffDelayMinutes(retryCount);

    const jitter = Math.floor(Math.random() * 30); // до 30 секунд
    
    const nextRetryAt = new Date(
      Date.now() +
        nextRetryMinutes * 60 * 1000 +
        jitter * 1000
    ).toISOString();
    
    await env.DB.prepare(`
      UPDATE deployments
      SET status = 'queued',
          retry_count = retry_count + 1,
          next_retry_at = ?
      WHERE id = ?
    `)
      .bind(nextRetryAt, item.id)
      .run();

      await addDeploymentEvent(
        env.DB,
        item.id,
        item.environment_id,
        "requeued",
        `Retry in ${nextRetryMinutes}m (attempt ${
          retryCount + 1
        })`
      );
  }

  return {
    ok: true,
    checked: result.results.length,
  };
}

async function syncGithubRuns(env: Env) {
  const running = await env.DB.prepare(`
    SELECT *
    FROM deployments
    WHERE status = 'dispatching'
  `).all();

  for (const item of running.results as any[]) {
    const deploymentId = item.id as string;

    if (item.last_checked_at) {
      const last = new Date(item.last_checked_at).getTime();
      if (Date.now() - last < 30_000) continue;
    }
    

    const res = await fetch(
      `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/actions/runs?per_page=5`,
      {
        headers: {
          Authorization: `Bearer ${env.GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
        },
      }
    );

    if (!res.ok) continue;

    const data: any = await res.json();

    const run = data.workflow_runs?.find((r: any) => {
      return r.name === "Provision Environment";
    });

    if (!run) continue;

    await env.DB.prepare(`
      UPDATE deployments
      SET last_checked_at = ?
      WHERE id = ?
    `)
      .bind(new Date().toISOString(), deploymentId)
      .run();

    if (run.status === "completed") {
      if (run.conclusion === "success") {
        continue;
      }

      await env.DB.prepare(`
        UPDATE deployments
        SET status = 'queued',
            retry_count = retry_count + 1
        WHERE id = ?
      `)
        .bind(deploymentId)
        .run();

      await addDeploymentEvent(
        env.DB,
        deploymentId,
        item.environment_id,
        "retry",
        `GitHub run failed: ${run.conclusion}`
      );
    }
  }
}

app.post("/api/deployments/process", async (c) => {
  const authHeader = c.req.header("Authorization");

  if (!isAuthorized(authHeader, c.env.CALLBACK_TOKEN)) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const result = await processDeploymentQueue(c.env);

  return c.json(result);
});

app.post("/api/deployments/:id/event", async (c) => {
  const authHeader = c.req.header("Authorization");

  if (!isAuthorized(authHeader, c.env.CALLBACK_TOKEN)) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const id = c.req.param("id");

  const body = await c.req.json<{
    type: string;
    message: string;
  }>();

  const deployment = await c.env.DB.prepare(`
    SELECT *
    FROM deployments
    WHERE id = ?
  `)
    .bind(id)
    .first();

  if (!deployment) {
    return c.json({ error: "deployment not found" }, 404);
  }

  await addDeploymentEvent(
    c.env.DB,
    id,
    deployment.environment_id as string,
    body.type,
    body.message
  );

  return c.json({ ok: true });
});

app.post("/api/deployments/:id/outputs", async (c) => {
  const authHeader = c.req.header("Authorization");

  if (!isAuthorized(authHeader, c.env.CALLBACK_TOKEN)) {
    return c.json({
      error: "unauthorized",
    }, 401);
  }

  const id = c.req.param("id");

  const deployment = await c.env.DB.prepare(`
    SELECT *
    FROM deployments
    WHERE id = ?
  `)
    .bind(id)
    .first();

  if (!deployment) {
    return c.json({
      error: "deployment not found",
    }, 404);
  }

  const envId = deployment.environment_id as string;

  const outputs = await c.req.json<any>();

  for (const [key, value] of Object.entries(outputs)) {
    const typedValue = value as any;

    await c.env.DB.prepare(`
      INSERT INTO deployment_outputs (
        id,
        deployment_id,
        environment_id,
        output_key,
        output_value,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `)
      .bind(
        crypto.randomUUID(),
        id,
        envId,
        key,
        JSON.stringify(typedValue.value),
        new Date().toISOString()
      )
      .run();
  }

  await addDeploymentEvent(
    c.env.DB,
    id,
    envId,
    "outputs_captured",
    "Runtime outputs captured"
  );

  return c.json({
    ok: true,
  });
});

app.post("/api/deployments/:id/complete", async (c) => {
  const authHeader = c.req.header("Authorization");

  if (!isAuthorized(authHeader, c.env.CALLBACK_TOKEN)) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const id = c.req.param("id");

  const deployment = await c.env.DB.prepare(`
    SELECT *
    FROM deployments
    WHERE id = ?
  `)
    .bind(id)
    .first();

  if (!deployment) {
    return c.json({ error: "deployment not found" }, 404);
  }

  const envId = deployment.environment_id as string;

  await c.env.DB.prepare(`
    UPDATE deployments
    SET status = 'success',
        finished_at = ?
    WHERE id = ?
  `)
    .bind(new Date().toISOString(), id)
    .run();

  await c.env.DB.prepare(`
    UPDATE environments
    SET status = 'running',
        updated_at = ?
    WHERE id = ?
  `)
    .bind(new Date().toISOString(), envId)
    .run();

  await addDeploymentEvent(
    c.env.DB,
    id,
    envId,
    "success",
    "Deployment completed successfully"
  );

  return c.json({
    ok: true,
    status: "success",
  });
});

app.post("/api/deployments/:id/destroy-complete", async (c) => {
  const authHeader = c.req.header("Authorization");

  if (!isAuthorized(authHeader, c.env.CALLBACK_TOKEN)) {
    return c.json({
      error: "unauthorized",
    }, 401);
  }

  const id = c.req.param("id");

  const deployment = await c.env.DB.prepare(`
    SELECT *
    FROM deployments
    WHERE id = ?
  `)
    .bind(id)
    .first();

  if (!deployment) {
    return c.json({
      error: "deployment not found",
    }, 404);
  }

  const envId = deployment.environment_id as string;

  await c.env.DB.prepare(`
    UPDATE deployments
    SET status = 'destroyed',
        finished_at = ?
    WHERE id = ?
  `)
    .bind(new Date().toISOString(), id)
    .run();

  await c.env.DB.prepare(`
    UPDATE environments
    SET status = 'destroyed',
        updated_at = ?
    WHERE id = ?
  `)
    .bind(new Date().toISOString(), envId)
    .run();

  await addDeploymentEvent(
    c.env.DB,
    id,
    envId,
    "destroyed",
    "Infrastructure destroyed"
  );

  return c.json({
    ok: true,
    status: "destroyed",
  });
});

app.notFound(async (c) => {
  return c.env.ASSETS.fetch(c.req.raw);
});

export default {
  fetch: app.fetch,

// ── Node check-in ──────────────────────────────────────────────────────────────

app.post("/api/nodes/checkin", async (c) => {
  const authHeader = c.req.header("Authorization");

  if (!isAuthorized(authHeader, c.env.CALLBACK_TOKEN)) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const body = await c.req.json<{
    environment_id: string;
    hostname?: string;
    public_ip?: string;
    agent_version?: string;
  }>();

  if (!body.environment_id) {
    return c.json({ error: "environment_id required" }, 400);
  }

  const environment = await c.env.DB.prepare(
    `SELECT id, name, provider FROM environments WHERE id = ?`
  )
    .bind(body.environment_id)
    .first<{ id: string; name: string; provider: string }>();

  if (!environment) {
    return c.json({ error: "environment not found" }, 404);
  }

  const now = new Date().toISOString();

  // Upsert — update if exists, insert if first check-in
  const existing = await c.env.DB.prepare(
    `SELECT id FROM nodes WHERE environment_id = ?`
  )
    .bind(body.environment_id)
    .first<{ id: string }>();

  if (existing) {
    await c.env.DB.prepare(`
      UPDATE nodes
      SET
        hostname = ?,
        public_ip = ?,
        agent_version = ?,
        status = 'online',
        last_seen_at = ?
      WHERE environment_id = ?
    `)
      .bind(
        body.hostname ?? null,
        body.public_ip ?? null,
        body.agent_version ?? null,
        now,
        body.environment_id
      )
      .run();

    return c.json({ ok: true, node_id: existing.id, action: "updated" });
  }

  const nodeId = crypto.randomUUID();

  await c.env.DB.prepare(`
    INSERT INTO nodes (
      id,
      environment_id,
      environment_name,
      provider,
      hostname,
      public_ip,
      agent_version,
      status,
      first_seen_at,
      last_seen_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, 'online', ?, ?)
  `)
    .bind(
      nodeId,
      body.environment_id,
      environment.name,
      environment.provider,
      body.hostname ?? null,
      body.public_ip ?? null,
      body.agent_version ?? null,
      now,
      now
    )
    .run();

  return c.json({ ok: true, node_id: nodeId, action: "created" });
});

app.get("/api/nodes", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM nodes ORDER BY last_seen_at DESC`
  ).all<Node>();

  return c.json(results);
});

app.get("/api/nodes/:id", async (c) => {
  const { id } = c.req.param();

  const node = await c.env.DB.prepare(
    `SELECT * FROM nodes WHERE id = ?`
  )
    .bind(id)
    .first<Node>();

  if (!node) return c.json({ error: "not found" }, 404);

  return c.json(node);
});

// ── reconcileNodeHealth ────────────────────────────────────────────────────────

async function reconcileNodeHealth(env: Env) {
  const UNREACHABLE_AFTER_MINUTES = 10;
  const cutoff = new Date(
    Date.now() - UNREACHABLE_AFTER_MINUTES * 60 * 1000
  ).toISOString();

  // Mark nodes unreachable if last_seen_at is too old
  const gone = await env.DB.prepare(`
    UPDATE nodes
    SET status = 'unreachable'
    WHERE status = 'online'
      AND last_seen_at < ?
    RETURNING id, environment_name
  `)
    .bind(cutoff)
    .all<{ id: string; environment_name: string }>();

  // Mark nodes back online if they checked in recently
  const recovered = await env.DB.prepare(`
    UPDATE nodes
    SET status = 'online'
    WHERE status = 'unreachable'
      AND last_seen_at >= ?
    RETURNING id, environment_name
  `)
    .bind(cutoff)
    .all<{ id: string; environment_name: string }>();

  return {
    unreachable: gone.results.length,
    recovered: recovered.results.length,
  };
}

  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext
  ) {
    const reconcileResult = await reconcileExpiredEnvironments(env);
  
    console.log("ttl reconcile", JSON.stringify(reconcileResult));
  
    const recoveryResult = await reconcileStuckDeployments(env);
  
    console.log("deployment recovery", JSON.stringify(recoveryResult));
  
    const queueResult = await processDeploymentQueue(env);
  
    console.log("scheduler tick", JSON.stringify(queueResult));
  
    const syncResult = await syncGithubRuns(env);
  
    console.log("github sync", JSON.stringify(syncResult));

    const nodeHealthResult = await reconcileNodeHealth(env);

    console.log("node health", JSON.stringify(nodeHealthResult));
  }
  
};