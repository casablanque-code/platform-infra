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
  GITHUB_REF: string;
};

const app = new Hono<{ Bindings: Env }>();

app.use("*", cors());

function isAuthorized(
  authHeader: string | undefined,
  token: string
) {
  if (!authHeader) {
    return false;
  }

  return authHeader === `Bearer ${token}`;
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

app.post("/api/environments", async (c) => {
  const body = await c.req.json<{
    name: string;
    provider: string;
    region: string;
    template: string;
    ttl_hours?: number;
  }>();

  const envId = crypto.randomUUID();
  const deploymentId = crypto.randomUUID();

  const now = new Date().toISOString();

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
      body.ttl_hours ?? 72,
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
    "Deployment queued by control plane"
  );

  return c.json({
    environment_id: envId,
    deployment_id: deploymentId,
    status: "queued",
  });
});

app.post("/api/deployments/process", async (c) => {
  const queued = await c.env.DB.prepare(`
    SELECT *
    FROM deployments
    WHERE status = 'queued'
    ORDER BY created_at ASC
    LIMIT 1
  `).first();

  if (!queued) {
    return c.json({
      ok: true,
      message: "no queued deployments",
    });
  }

  const deploymentId = queued.id as string;
  const envId = queued.environment_id as string;

  const environment = await c.env.DB.prepare(`
    SELECT *
    FROM environments
    WHERE id = ?
  `)
    .bind(envId)
    .first();

  if (!environment) {
    return c.json({
      error: "environment not found",
    }, 404);
  }

  await c.env.DB.prepare(`
    UPDATE deployments
    SET status = 'dispatching'
    WHERE id = ?
  `)
    .bind(deploymentId)
    .run();

  await c.env.DB.prepare(`
    UPDATE environments
    SET status = 'dispatching',
        updated_at = ?
    WHERE id = ?
  `)
    .bind(new Date().toISOString(), envId)
    .run();

  await addDeploymentEvent(
    c.env.DB,
    deploymentId,
    envId,
    "dispatching",
    "Dispatching GitHub Actions workflow"
  );

  const response = await fetch(
    `https://api.github.com/repos/${c.env.GITHUB_OWNER}/${c.env.GITHUB_REPO}/actions/workflows/${c.env.GITHUB_WORKFLOW}/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${c.env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "platform-infra-control-plane",
      },
      body: JSON.stringify({
        ref: c.env.GITHUB_REF,
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
      c.env.DB,
      deploymentId,
      envId,
      "dispatch_failed",
      errorText
    );

    return c.json({
      error: "workflow dispatch failed",
      details: errorText,
    }, 500);
  }

  await addDeploymentEvent(
    c.env.DB,
    deploymentId,
    envId,
    "workflow_dispatched",
    "GitHub Actions workflow dispatched"
  );

  return c.json({
    ok: true,
    deployment_id: deploymentId,
    status: "dispatching",
  });
});

app.post("/api/deployments/:id/event", async (c) => {
  const authHeader = c.req.header("Authorization");

  if (!isAuthorized(authHeader, c.env.CALLBACK_TOKEN)) {
    return c.json({
      error: "unauthorized",
    }, 401);
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
    return c.json({
      error: "deployment not found",
    }, 404);
  }

  await addDeploymentEvent(
    c.env.DB,
    id,
    deployment.environment_id as string,
    body.type,
    body.message
  );

  return c.json({
    ok: true,
  });
});

app.post("/api/deployments/:id/complete", async (c) => {
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

app.notFound(async (c) => {
  return c.env.ASSETS.fetch(c.req.raw);
});

export default app;