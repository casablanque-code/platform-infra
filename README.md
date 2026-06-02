# platform-infra

Self-hosted infrastructure platform for small engineering teams. Provision VMs, bootstrap services, track nodes, run runtime actions — from a web UI. No tickets, no bottlenecks, no SaaS vendor.

→ [Landing](https://platform.casablanque.com) · [Dashboard](https://infra.casablanque.com)

---

## What it does

- **Self-service provisioning** — web UI to create environments on any supported provider. No CLI, no YAML, no Terraform knowledge needed.
- **Multi-cloud** — IONOS, Hetzner, Oracle, AWS, Azure, GCP, Yandex via provider abstraction. Switch provider with one click.
- **Auto-lifecycle** — configurable TTL (1h / 6h / 24h / 72h / 7d / ∞), automatic destroy on expiry. No zombie environments.
- **Post-provision bootstrap** — SSH scripts run after every apply: base hardening, Docker CE, service installs, node registration.
- **Node inventory** — nodes check in after bootstrap and every 5 minutes. Control plane tracks health, IP, last seen. Self-cleaning: node removes itself when environment is destroyed.
- **Runtime actions** — reboot, redeploy, run playbooks (Portainer, Node Exporter, Uptime Kuma, pgAdmin, R2 backup) directly from the dashboard.
- **RBAC** — admin / operator / viewer roles. API keys with expiry. Audit log for all mutations.
- **Encrypted outputs** — sensitive values (SSH private keys, DB passwords) encrypted with AES-GCM before storing in D1.
- **Per-environment SSH keys** — unique ED25519 key generated per environment via OpenTofu `tls_private_key`. Shown in dashboard, never stored in plain text.
- **Mock gateway** — local Go server that emulates a cloud provider API. Test full tofu cycle (create → polling → destroy) without real cloud credentials or costs.

---

## Architecture

```
Browser (React dashboard)
    │
    ▼
Cloudflare Workers (control plane API)  ←── cron every minute
    │                │
    │                ▼
    │           Cloudflare D1 (SQLite)
    │
    ▼
GitHub Actions (executor)
    ├── provision.yml  →  tofu apply  →  bootstrap via SSH  →  /complete
    ├── destroy.yml    →  tofu destroy  →  /destroy-complete
    └── action.yml     →  SSH runtime action (reboot / playbook / redeploy)

State: Cloudflare R2 (S3-compatible tofu backend, keyed by environment_id)
```

**Why GitHub Actions as executor?** Free distributed runner, no agent to maintain, native secrets management, full audit trail.

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
| Bootstrap | Bash (idempotent scripts) |

---

## Quick start

### Prerequisites

- Cloudflare account (Workers + D1 + R2 — all free tier)
- GitHub account with Actions enabled
- `wrangler` CLI: `npm i -g wrangler && wrangler login`
- `gh` CLI: https://cli.github.com → `gh auth login`
- `yq`: `brew install yq` or `snap install yq`

### 1. Clone

```bash
git clone https://github.com/casablanque-code/platform-infra
cd platform-infra
```

### 2. Create Cloudflare resources

```bash
# D1 database
wrangler d1 create platform_infra
# → copy the database_id for the next step

# R2 bucket (for tofu state)
wrangler r2 bucket create platform-infra-state
# → create R2 API token: Cloudflare Dashboard → R2 → Manage API Tokens
```

### 3. Configure

```bash
cp platform.config.example.yml platform.config.yml
# Edit platform.config.yml — fill in all values
```

Key fields:
| Field | Where to find |
|---|---|
| `cloudflare.d1_database_id` | Output of `wrangler d1 create` |
| `cloudflare.r2_*` | R2 → Manage API Tokens |
| `github.token` | github.com/settings/tokens (scopes: repo, workflow) |
| `secrets.*` | Generate with `openssl rand -hex 32` |
| `bootstrap.ssh_private_key` | `ssh-keygen -t ed25519 -f ~/.ssh/platform_bootstrap -N ""` |

### 4. Run setup

```bash
bash setup.sh
```

This will:
- Update `wrangler.jsonc` with your D1 database ID
- Set all Cloudflare Workers secrets
- Set all GitHub Actions secrets
- Update `providers/*.json` with your provider config
- Apply D1 migrations
- Build and deploy the Worker

### 5. Open the dashboard

Go to `https://platform-control-plane.workers.dev` and sign in with your `admin_key`.

---

## Project structure

```
platform-infra/
├── workers/control-plane/
│   ├── src/index.ts          # Hono API + cron scheduler
│   ├── migrations/           # D1 schema (0001–0011)
│   └── wrangler.jsonc        # auto-updated by setup.sh
├── apps/dashboard/
│   └── src/App.tsx           # React SPA (served via Workers Assets)
├── templates/
│   ├── docker-host/
│   │   ├── template.json     # UI metadata (name, providers, TTL)
│   │   ├── runtime.json      # executor config, post_provision, actions
│   │   └── tofu/main.tf      # OpenTofu module
│   └── postgres/
│       └── ...
├── providers/
│   ├── ionos/provider.json   # static IP (existing server)
│   ├── mock/provider.json    # infra-mock-gateway
│   ├── hetzner/provider.json # tfvars (real provider WIP)
│   ├── aws/provider.json
│   ├── azure/provider.json
│   ├── gcp/provider.json
│   └── yandex/provider.json
├── bootstrap/
│   ├── base.sh               # hardening, fail2ban, ufw
│   ├── docker.sh             # Docker CE + Compose
│   ├── checkin.sh            # node registration + self-cleaning cron
│   ├── install_portainer.sh
│   ├── install_node_exporter.sh
│   ├── install_uptime_kuma.sh
│   ├── install_pgadmin.sh
│   └── backup_to_r2.sh
├── infra-mock-gateway/
│   └── main.go               # mock cloud provider API (Go)
├── .github/workflows/
│   ├── provision.yml
│   ├── destroy.yml
│   └── action.yml
├── platform.config.example.yml  # copy → platform.config.yml
├── setup.sh                      # onboarding script
└── MOCK_REGISTRY.md              # mock stubs + real provider migration guide
```

---

## Dashboard tabs

| Tab | What's there |
|---|---|
| Dashboard | Env / deployment / node counters (separate sections), provider grid, recent activity |
| Environments | Filters, TTL progress bar, node health inline, outputs (decrypted), runtime actions with playbook picker |
| Deployments | Event timeline per job, retry count, delete |
| Nodes | Inventory with last seen, delete |
| Create | Template picker, provider buttons, TTL selector, template inputs |
| Keys | API key management — admin only |
| Audit | Mutation log — admin only |

---

## RBAC

| Role | Can do |
|---|---|
| `admin` | Everything + manage API keys + view audit log |
| `operator` | Create/destroy environments, run actions, delete deployments/nodes |
| `viewer` | Read-only access to all resources |

Admin key is set via `wrangler secret put ADMIN_KEY` (or `setup.sh`).
Operator/viewer keys are created in the dashboard → Keys tab.

---

## Environment lifecycle

```
queued
  → dispatching
    → github_actions_started
    → runtime_resolved
    → outputs_captured
    → bootstrap_skipped (mock) | bootstrap_complete (real)
  → success (running)

running → destroy_queued → dispatching → destroyed
```

- Failed deployments retry with exponential backoff
- Stuck deployments (dispatching > 10 min) auto-recovered by cron
- TTL expiry triggers automatic destroy + node cleanup
- Node self-removes from inventory when environment is destroyed

---

## Mock gateway (for testing)

Test the full tofu cycle without real cloud credentials:

```bash
# On any Linux server (e.g. your IONOS VPS)
cd infra-mock-gateway
go run main.go
# → http://YOUR_IP:8080/dashboard

# Open port 8080
sudo ufw allow 8080/tcp
```

Set in `platform.config.yml`:
```yaml
providers:
  mock:
    enabled: true
    gateway_url: "http://YOUR_IP:8080"
```

See [MOCK_REGISTRY.md](./MOCK_REGISTRY.md) for full details.

---

## Connecting a real provider

All providers currently use static IP (IONOS) or mock (gateway). To add a real cloud provider:

1. Write a proper `templates/<template>/tofu/main.tf` with provider resources
2. Add provider credentials to GitHub Secrets
3. Add `BOOTSTRAP_SSH_KEY` — private key deployed to VMs via cloud-init

See [MOCK_REGISTRY.md](./MOCK_REGISTRY.md) for per-provider secrets and migration checklist.

---

## Roadmap

- [ ] Real provider modules — Hetzner first (cx22, ~€3/mo)
- [ ] Zero Trust access — Tailscale mesh, no open ports
- [ ] OPA governance — pre-apply cost/security policies
- [ ] Template catalog — K3s, WireGuard, Redis, n8n
- [ ] Secrets management — per-environment encrypted secrets
- [ ] Multi-tenancy — project isolation, team RBAC

---

## License

MIT
