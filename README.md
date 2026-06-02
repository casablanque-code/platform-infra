# platform-infra

Self-hosted infrastructure platform for small engineering teams. Provision VMs, bootstrap services, track nodes, run actions — from a web UI. No tickets, no bottlenecks, no SaaS vendor.

→ [Landing](https://platform.casablanque.com) · [Control plane dashboard](https://infra.casablanque.com)

---

## What it does

- **Self-service provisioning** — web UI to create environments (Docker Host, PostgreSQL) on any supported cloud provider
- **Multi-cloud** — Hetzner, Oracle, AWS, Azure, GCP, Yandex Cloud via provider abstraction
- **Auto-lifecycle** — configurable TTL (1h–7d), automatic destroy on expiry, no zombie environments
- **Post-provision bootstrap** — base hardening, Docker CE, service install via SSH scripts after every apply
- **Node inventory** — nodes check in after bootstrap, control plane tracks health and last seen, flags unreachable
- **Runtime actions** — reboot, redeploy, run playbooks (Portainer, Node Exporter, Uptime Kuma, pgAdmin, R2 backup) from the dashboard
- **Deployment history** — full event log with retry count, duration, links to GitHub Actions runs

---

## Architecture

```
Browser (React dashboard)
    │
    ▼
Cloudflare Workers (control plane)  ←─── cron scheduler (every minute)
    │           │
    │           ▼
    │       Cloudflare D1 (SQLite)
    │           │
    ▼           ▼
GitHub Actions (executor)
    │
    ├── provision.yml  →  OpenTofu apply  →  bootstrap scripts  →  /complete
    ├── destroy.yml    →  OpenTofu destroy  →  /destroy-complete
    └── action.yml     →  SSH action (reboot / run_script / redeploy)

State storage: Cloudflare R2 (S3-compatible OpenTofu backend)
```

**Why GitHub Actions as executor?**
Free distributed runner, no agent infrastructure to maintain, native secrets management, full audit trail via Actions logs.

---

## Stack

| Layer | Tech |
|---|---|
| Control plane | Cloudflare Workers + Hono |
| Database | Cloudflare D1 (SQLite) |
| State backend | Cloudflare R2 |
| Frontend | React 19 + Tailwind 4 + Vite |
| IaC | OpenTofu |
| Executor | GitHub Actions |
| Bootstrap | Bash scripts (idempotent) |

---

## Getting started

### Prerequisites

- Cloudflare account (Workers, D1, R2 — all on free tier)
- GitHub account with Actions enabled
- `wrangler` CLI installed (`npm i -g wrangler`)
- `tofu` installed

### 1. Clone

```bash
git clone https://github.com/casablanque-code/platform-infra
cd platform-infra
```

### 2. Create D1 database

```bash
wrangler d1 create platform-infra
# Copy database_id to wrangler.jsonc
wrangler d1 migrations apply platform-infra --remote
```

### 3. Create R2 bucket

```bash
wrangler r2 bucket create platform-infra-state
```

Get your R2 credentials: Cloudflare Dashboard → R2 → Manage API Tokens.

### 4. Set Cloudflare Workers secrets

```bash
wrangler secret put GITHUB_TOKEN          # PAT with workflow scope
wrangler secret put CALLBACK_TOKEN        # random string, e.g. openssl rand -hex 32
wrangler secret put GITHUB_OWNER          # your GitHub username
wrangler secret put GITHUB_REPO           # platform-infra
wrangler secret put GITHUB_WORKFLOW       # provision.yml
wrangler secret put GITHUB_DESTROY_WORKFLOW # destroy.yml
wrangler secret put GITHUB_ACTION_WORKFLOW  # action.yml
wrangler secret put GITHUB_REF            # main
```

### 5. Set GitHub Actions secrets

```
CONTROL_PLANE_URL     https://your-worker.workers.dev
CALLBACK_TOKEN        same as above
R2_ACCESS_KEY_ID      from Cloudflare R2 API token
R2_SECRET_ACCESS_KEY  from Cloudflare R2 API token
R2_BUCKET             platform-infra-state
R2_ENDPOINT           https://<account_id>.r2.cloudflarestorage.com
```

For real bootstrap (SSH into actual VMs):
```
BOOTSTRAP_SSH_KEY     private key matching the public key deployed to VMs
```

### 6. Deploy

```bash
# Deploy control plane
cd workers/control-plane
wrangler deploy

# Deploy dashboard
cd apps/dashboard
npm run build
wrangler pages deploy dist
```

---

## Project structure

```
platform-infra/
├── workers/
│   └── control-plane/
│       ├── src/index.ts          # Hono API + scheduler
│       └── migrations/           # D1 schema (0001–0009)
├── apps/
│   └── dashboard/
│       └── src/App.tsx           # React SPA
├── templates/
│   ├── docker-host/
│   │   ├── template.json         # UI metadata
│   │   ├── runtime.json          # executor config + post_provision + actions
│   │   └── tofu/main.tf          # OpenTofu module (mock → replace with real)
│   └── postgres/
│       └── ...
├── providers/
│   ├── hetzner/provider.json     # tfvars per provider
│   ├── oracle/provider.json
│   ├── aws/provider.json
│   ├── azure/provider.json
│   ├── gcp/provider.json
│   └── yandex/provider.json
├── bootstrap/
│   ├── base.sh                   # hardening + essentials
│   ├── docker.sh                 # Docker CE install
│   ├── checkin.sh                # node registration
│   ├── install_portainer.sh
│   ├── install_node_exporter.sh
│   ├── install_uptime_kuma.sh
│   ├── install_pgadmin.sh
│   └── backup_to_r2.sh
├── .github/workflows/
│   ├── provision.yml
│   ├── destroy.yml
│   └── action.yml
└── MOCK_REGISTRY.md              # all stubs + migration guide
```

---

## Connecting a real cloud provider

Currently all providers use mock outputs (IP `203.0.113.10`). To connect a real provider:

1. Replace `templates/<template>/tofu/main.tf` with real provider resources
2. Add provider credentials to GitHub Secrets (see `MOCK_REGISTRY.md` for exact secret names per provider)
3. Add `BOOTSTRAP_SSH_KEY` secret — private key matching the public key deployed to VMs
4. Create environment from UI — full cycle runs including bootstrap and node check-in

See [`MOCK_REGISTRY.md`](./MOCK_REGISTRY.md) for the complete migration checklist.

---

## Dashboard

| Tab | What's there |
|---|---|
| Dashboard | Env / deployment / node health counters, provider status, recent activity |
| Environments | List with filters, TTL bar, node health inline, outputs, runtime actions |
| Deployments | Job history with event timeline, retry count, delete |
| Nodes | Registered nodes with last seen, delete |
| Create | Template picker, provider selector, TTL picker, template-specific inputs |

---

## Environment lifecycle

```
queued → dispatching → [github_actions_started → runtime_resolved →
         outputs_captured → bootstrap_skipped/bootstrap_complete] → success

success → destroy_queued → dispatching → destroyed
```

Failed deployments retry with exponential backoff. Stuck deployments (dispatching > 10 min) are recovered by cron. TTL expiry triggers automatic destroy.

---

## Roadmap

- [ ] Zero Trust access (identity-aware proxy, JWT auth, no open ports)
- [ ] OPA governance (cost limits, security rules before apply)
- [ ] Multi-user + RBAC + API keys
- [ ] Audit log (events already structured, write path pending)
- [ ] Real provider modules (Hetzner, Oracle free tier first)
- [ ] Secrets management (encrypted per-environment secrets in D1)
- [ ] Template catalog expansion (K3s, WireGuard, n8n, Redis)

---

## License

MIT
