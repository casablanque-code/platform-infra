# Architecture

This document explains platform-infra end to end — from an empty
`platform.config.yml` to a developer getting a container. If you've never
seen this codebase before, read this top to bottom before touching code.

---

# Design principles

• Control plane never executes infrastructure code  
• Infrastructure is immutable  
• Terraform is the single source of truth  
• Workers own state  
• GitHub Actions own execution  
• Providers are plugins  
• Templates describe products, not infrastructure  
• Every operation is idempotent

---

## 1. The three roles in this system

Before anything else, separate these three people in your head — the doc
keeps switching between them:

| Role | What they do | When |
|---|---|---|
| **You, setting up the platform** | Fill in `platform.config.yml`, run `setup.sh` once | Once, at install time |
| **Platform admin** (could be the same person) | Manages templates, providers, API keys, watches the audit log | Ongoing, occasionally |
| **Developer / end user** | Opens the dashboard, clicks "create", gets a container | Daily, self-service |

The whole point of this project: step 1 and 2 happen once and are boring.
Step 3 happens constantly and requires zero infrastructure knowledge.

---

## 2. What each moving part actually is

```
platform.config.yml   →  the ONE file only you (the installer) ever fill in.
                          Never committed to git. Read once, by setup.sh.

setup.sh               →  reads platform.config.yml, configures Cloudflare
                          (Workers secrets, D1, R2) and GitHub (Actions
                          secrets), installs Incus if you asked it to,
                          deploys the control plane, and prints the
                          command to register your GitHub Actions runner.
                          You run this once. You may re-run it safely if
                          you change config later — it's idempotent.

Control plane           →  a Cloudflare Worker (Hono framework). This is
(workers/control-plane)   the brain: an HTTP API, a SQLite database (D1),
                          and a bucket for Terraform state (R2). It knows
                          nothing about SSH, Incus, or bootstrap scripts —
                          it only tracks *state* (what exists, what's
                          queued, who's allowed to do what) and dispatches
                          work to GitHub Actions.

Dashboard                →  a small React app, also served by the same
(apps/dashboard)           Cloudflare account (as static assets). Talks to
                          the control plane API. This is what your
                          developers actually see and click.

providers/<name>/        →  one folder per infrastructure backend.
provider.json              Each provider.json says: "here are the default
                          Terraform variables for this backend" (e.g.
                          which Incus image to boot, which project).
                          Today only providers/incus/ is real.
                          providers/proxmox/ and providers/cloud/ are
                          documented stubs — see their NOTES.md.

templates/<name>/        →  one folder per "thing a developer can create".
  template.json             template.json = the FORM: name, description,
  runtime.json                what provider(s) it supports, what inputs
  tofu/main.tf               (CPU/RAM/etc) show up in the dashboard.
                            runtime.json = the RECIPE: which Terraform
                            module to run, which outputs to capture, which
                            bootstrap scripts to run after, which runtime
                            actions (reboot, install X) are available.
                            tofu/main.tf = the actual Terraform/OpenTofu
                            code that talks to the provider's API and
                            creates the real container/VM.

bootstrap/*.sh            →  shell scripts that run over SSH, on the
                            container itself, after Terraform creates it.
                            base.sh hardens SSH, docker.sh installs
                            Docker, install_cfzt.sh sets up the Zero
                            Trust tunnel client, checkin.sh installs a
                            cron job the container uses to report back
                            "I'm alive" every 5 minutes. install_*.sh
                            scripts are optional, on-demand (triggered as
                            "actions" from the dashboard, not part of the
                            automatic chain).

.github/workflows/        →  provision.yml, destroy.yml, action.yml.
                            These are the actual *executors*. The control
                            plane can't run Terraform or SSH into anything
                            itself (Workers have no shell) — so it
                            dispatches a GitHub Actions workflow_dispatch
                            event, and a **self-hosted runner sitting on
                            your Incus server** picks it up and does the
                            real work.
```

The reason for the GitHub Actions detour: Cloudflare Workers can run
JavaScript/TypeScript at the edge, but they cannot run `tofu apply` or SSH
into a server. Something with a real shell has to do that. Rather than
build and host a custom executor, this project reuses GitHub Actions'
self-hosted runner feature — you point one runner at your Incus box, and
it becomes the hands that actually do the provisioning.

---

## 3. Setup, step by step (what you do once)

### 3.1 — `platform.config.yml`

Copy `platform.config.example.yml` → `platform.config.yml`. It has six
sections. Here's what each one is *for*, not just what to type:

**`provider.type`** — `incus`, `proxmox`, or `cloud`. This one value
decides which of the other provider-specific sections `setup.sh` will
actually read. Today only `incus` does anything; the other two exist so
the config shape doesn't change later when they're implemented.

**`cloudflare.*`** — the control plane's home. `account_id` identifies
your Cloudflare account. `d1_database_id` is the SQLite database's ID
(you create the database yourself first: `wrangler d1 create
platform_infra`, then paste the ID it prints). `r2_bucket` /
`r2_endpoint` / `r2_access_key_id` / `r2_secret_access_key` are for the
R2 bucket that stores Terraform state files — one per environment, so
Terraform always knows what it already created and won't create it
twice.

**`github.*`** — where the workflows live and how `setup.sh` talks to
GitHub's API on your behalf (to register the runner, set secrets). This
is almost always your fork/clone of this exact repo.

**`secrets.*`** — three random tokens *you* generate
(`openssl rand -hex 32` each):
- `callback_token` — how the GitHub Actions runner authenticates back to
  the control plane (e.g. "provisioning finished", "here are the
  outputs"). Machine-to-machine, not a user credential.
- `admin_key` — the first API key for the platform. This is what you
  paste into the dashboard's login screen the very first time. Create
  scoped operator/viewer keys afterward and stop using this one day to
  day.
- `encryption_key` — encrypts sensitive values at rest in D1 (SSH
  private keys, DB passwords) using AES-GCM. If you lose this, those
  values become unrecoverable.

**`incus.*`** — leave `remote_addr` blank and `setup.sh` installs Incus
*on the machine you're running setup.sh on* and configures everything
(HTTPS API, trust token) automatically. If you already have Incus
running somewhere — another box on your LAN, a dedicated server — fill
in its address and a trust token instead
(`incus config trust add --name platform` on that machine) and `setup.sh`
skips installation entirely and just uses it. Same mechanism either way:
this section is "how do I reach the Incus API", nothing more.

**`proxmox.*` / `cloud.*`** — not implemented. `setup.sh` refuses to
proceed if `provider.type` is set to either and just tells you where the
implementation notes are (`providers/proxmox/NOTES.md`,
`providers/cloud/NOTES.md`).

**`cloudflare_tunnel.*`** — optional. If filled in, every container gets
Cloudflare Tunnel access for its installed services (Portainer, pgAdmin,
etc) with no firewall ports opened. Leave `domain` blank to skip this
entirely — nothing else depends on it.

### 3.2 — Running `setup.sh`

```
sudo bash setup.sh
```

What it actually does, in order:

1. Checks `wrangler`, `gh`, `yq` are installed and you're logged into
   both Cloudflare and GitHub.
2. Reads and validates `platform.config.yml`.
3. **Provider setup** (dispatches on `provider.type`):
   for `incus` — if `remote_addr` is blank, installs `cloudflared`... no,
   installs `incus` + `incus-client` via apt (falling back to the Zabbly
   repo if your distro doesn't ship Incus in default repos — true for
   Ubuntu ≤22.04), runs `incus admin init --minimal`, turns on the HTTPS
   API, generates a trust token. If `remote_addr` was already filled in,
   skips all of this and just validates the token works.
4. Sets Cloudflare Workers secrets (`wrangler secret put` for
   `CALLBACK_TOKEN`, `ADMIN_KEY`, `ENCRYPTION_KEY`, R2 credentials).
5. Sets GitHub Actions repo secrets (`CONTROL_PLANE_URL`,
   `CALLBACK_TOKEN`, `INCUS_REMOTE_ADDR`, `INCUS_TOKEN`, R2 credentials,
   and `CFZT_*` if you filled in the tunnel section).
6. Applies D1 migrations, deploys the Worker (`wrangler deploy`).
7. Fetches a GitHub Actions runner registration token via the GitHub API
   and prints the exact commands to register a self-hosted runner
   (labelled `incus-host`) — **you run these on the same machine as
   Incus**. This is the last manual step; everything after this is
   automatic.

At the end you get a dashboard URL and the admin key. That's the whole
install.

### 3.3 — What "the self-hosted runner" actually means

This is the part that trips people up most, so it gets its own
paragraph. A GitHub Actions *self-hosted runner* is just a small daemon
(`actions-runner`) that polls GitHub for jobs targeting a specific label
and executes them **on whatever machine it's installed on**, using that
machine's own filesystem, network, and installed tools. By running it on
your Incus host, "GitHub Actions runs `tofu apply`" really means "your
own server runs `tofu apply` against its own local Incus API" — GitHub
is only coordinating *when* that happens and carrying the logs, nothing
about your infrastructure ever has to be reachable from GitHub's cloud.

---

## 4. What happens when a developer clicks "Create"

This is the same numbered flow as the diagram above, but now with every
file/table name attached, so you can trace it in the actual code.

**① Dashboard → API.** `CreateTab.tsx` sends
`POST /api/environments` with `{ name, provider, template, ttl_hours,
inputs }`. `inputs` are the per-template fields (CPU, RAM, etc. — see
`template.json`'s `inputs` array; each template defines its own).

**② Control plane validates and queues.** `index.ts`'s handler checks
the template exists, the chosen provider is one the template supports,
then inserts a row into D1's `environments` table (`status = queued`)
and a matching row in `deployments` (`status = queued`). Nothing has
been created yet — this is purely a database write. A cron trigger
(`scheduled()` in `index.ts`, firing every minute per `wrangler.jsonc`)
polls for queued deployments and dispatches them.

**③ Dispatch → GitHub Actions.** The control plane calls GitHub's API to
trigger `provision.yml` via `workflow_dispatch`, passing `deployment_id`,
`environment_id`, `environment_name`, `provider`, `region`, `template`
as inputs. The `run-name` embeds `deployment_id` so the control plane can
later match this specific run back to this specific deployment
unambiguously (`syncGithubRuns()`), even if several provisions are
running at once.

**④ Runner picks it up.** Your self-hosted runner (on the Incus box)
receives the job. First step: `Resolve runtime manifest` reads
`templates/<template>/runtime.json` to find which Terraform module to
use (`executor.module_path`) and whether there's a bootstrap chain
(`post_provision`).

**⑤ Generate tfvars.** Merges `providers/<provider>/provider.json`'s
static `runtime.tfvars` (e.g. `image: ubuntu/22.04/cloud`) with the
dynamic values only known at dispatch time (`environment_id`,
`incus_remote_addr`, `incus_token` from GitHub secrets) into
`terraform.tfvars.json`.

**⑥ `tofu init` + `tofu apply`.** State backend is R2, keyed by
`state/<environment_id>/terraform.tfstate` — every environment's
Terraform state lives at its own path, so environments never collide
and destroying one never touches another. `tofu apply` runs the actual
`templates/<template>/tofu/main.tf`, which (for the `incus` provider)
generates a fresh ED25519 keypair (`tls_private_key.env_key` — unique
per environment, not shared), creates the `incus_instance` resource with
that public key injected via `cloud-init.user-data`, and outputs
`public_ip`, `ssh_user`, `ssh_port`, `ssh_public_key`,
`ssh_private_key`, plus template-specific outputs (`db_password` etc.
for postgres).

**⑦ Outputs go back to the control plane.** `POST
/api/deployments/:id/outputs` with the full Terraform output JSON.
Values considered sensitive (`ssh_private_key`, `db_password`, ...) are
encrypted with `ENCRYPTION_KEY` before being stored in D1's
`deployment_outputs` table. This is the *only* place the plaintext
private key exists outside the runner's temporary disk during this run.

**⑧ Bootstrap chain runs over SSH.** The runner waits for SSH to come up
on the new container, then runs each `post_provision` script from
`runtime.json`, in order, over that SSH connection, using the
just-generated per-environment private key (never a shared key). For
`docker-host`/`postgres` today that's `base.sh` (SSH hardening, ufw),
`docker.sh` (Docker CE + Compose), `install_cfzt.sh` (Cloudflare Tunnel
client, only does anything if `CFZT_*` secrets are set), `checkin.sh`
(installs the self-report cron described in step ⑩). Each script is
idempotent — safe to re-run.

**⑨ Completion.** `POST /api/deployments/:id/complete` flips the
deployment to `success` and the environment to `running`. The dashboard,
polling every few seconds, now shows it as live.

---

## 5. What happens after "running" — the container's ongoing life

**⑩ Self check-in.** `checkin.sh` installed a cron entry that, every 5
minutes, hits `POST /api/nodes/checkin` with the container's own
hostname, IP, and agent version. The control plane's `nodes` table
tracks `first_seen_at` / `last_seen_at`; the dashboard's Nodes tab marks
anything not seen in a while as unreachable. This is also how the
container notices its *own* environment was destroyed — the same script
periodically checks `GET /api/environments/:id/exists` and, if the
environment is gone, cleans up its own cron entry rather than continuing
to phone home forever.

**⑪ Zero Trust (optional).** If `cloudflare_tunnel.domain` was
configured, any service installed afterward (Portainer, Uptime Kuma,
pgAdmin — see step ⑫) is additionally exposed through Cloudflare Tunnel
via `cfzt`, so it's reachable at `https://<service>.<your-domain>`
without opening a single inbound firewall port. SSH access for
provisioning/actions is unaffected either way — the tunnel only covers
the extra services, not the platform's own access path.

**⑫ Runtime actions.** The dashboard's Environments tab exposes
per-template actions (from `runtime.json`'s `actions` array) — e.g.
"Install Portainer", "Reboot", "Backup to R2". Clicking one does
`POST /api/environments/:id/actions`, which queues an `actions` row and
dispatches `action.yml` the same way provisioning did (steps ③–④), except
it fetches the per-environment SSH key from
`GET /api/environments/:id/ssh-credentials` (a narrow, machine-token-gated
endpoint — not the full outputs set) instead of generating a new one.

---

## 6. How it ends

Every environment has a TTL (`ttl_hours`, chosen at creation time,
default comes from the template's `default_ttl_hours`). Two paths lead
to the same place:

**⑬a — automatic.** The same cron that dispatches queued deployments
also checks for environments past their expiry and flips them to
`destroy_queued`.

**⑬b — manual.** Clicking "destroy" in the dashboard does the same flip
immediately (`POST /api/environments/:id/destroy`).

Either way, `destroy.yml` runs on the same self-hosted runner, re-inits
Terraform against the same R2 state path, and runs `tofu destroy`. The
container is gone, its Terraform state is cleared, and (per step ⑩) the
node's own cron notices on its next check-in cycle and stops trying to
report in — though by then the container itself no longer exists to run
it.

---

## 7. Where access control fits into all of this

Three roles, checked on every API call by `requireRole()` in `index.ts`:

- **viewer** — read-only. See environments, deployments, nodes.
- **operator** — viewer + create/destroy environments, run actions.
- **admin** — operator + manage API keys, read the audit log.

API keys are created from the dashboard (admin only), hashed before
storage, and can carry an expiry. Every mutating action writes a row to
the `audit_log` table (`writeAuditLog()`) — who, what, when. The GitHub
Actions callbacks (steps ⑦⑧⑨) don't use API keys or RBAC at all — they
authenticate with the separate `CALLBACK_TOKEN`, a machine-to-machine
secret with no user identity attached, checked by a handful of narrowly
scoped endpoints (`isAuthorized()` instead of `requireRole()`) that
intentionally return less data than their user-facing equivalents.

---

## 8. Summary diagram

```
you fill in ──▶ platform.config.yml ──▶ setup.sh (once) ──▶ control plane live
                                              │                    │
                                              ▼                    │
                                   self-hosted runner ◀────────────┘
                                   registered on Incus host
                                              │
   developer ──▶ dashboard ──▶ control plane ──▶ workflow_dispatch
                                   (D1 + R2)          │
                                              ▼
                                   runner: tofu apply ──▶ Incus API
                                              │                │
                                              ▼                ▼
                                   bootstrap over SSH    container exists
                                              │
                                              ▼
                                   outputs + status ──▶ control plane
                                              │
                                              ▼
                                   container checks in every 5 min
                                              │
                              TTL expires or "destroy" clicked
                                              │
                                              ▼
                                   runner: tofu destroy ──▶ gone
```

---

## 9. Sources of truth

Three things describe "what exists" and they are not the same thing:

| | What it actually tracks | Who can change it |
|---|---|---|
| **D1** (`environments` table) | Lifecycle/desired state: what the platform believes should exist, and what state it should be in (`queued`, `running`, `destroy_queued`, `destroyed`...) | The control plane API, in response to user actions and cron |
| **Terraform state** (in R2, per environment) | The last configuration OpenTofu successfully applied for that environment | `tofu apply` / `tofu destroy`, run by the self-hosted runner |
| **Incus** | Physical reality — what containers actually exist on the host right now | Anything with access to the Incus API, including a human running `incus delete` by hand |

In normal operation these three agree. They can drift: `tofu destroy` can
fail partway through and leave a container running while D1 already
says `destroyed`; someone can `incus delete` a container directly,
leaving D1 saying `running` for something that no longer exists;
`tofu apply` can partially succeed and leave Terraform state
inconsistent with either D1 or Incus.

The control plane cannot check Incus directly — a Cloudflare Worker has
no network path to a server on your LAN. Only the self-hosted runner
does. This is why the reconciler (below) is a scheduled *workflow*, not
Worker code: it's the only thing physically positioned to compare D1
against Incus.

---

## 10. Reconciler

`.github/workflows/reconcile.yml` runs hourly on the self-hosted runner
(and on demand via `workflow_dispatch`). It lists actual Incus instances
and posts them to `POST /api/reconcile`, which compares that list
against every D1 environment with `status = 'running'` and flags two
kinds of drift:

- **Orphaned in Incus** — an instance named `platform-*` exists on the
  host with no corresponding `running` environment in D1. Something is
  consuming resources that the platform has lost track of.
- **Orphaned in D1** — an environment D1 believes is `running` has no
  matching Incus instance. The platform thinks something exists that
  doesn't.

Each run is stored (`reconcile_runs` table) and each individual finding
is written to the audit log. The dashboard shows a warning card when the
latest run found anything.

This is deliberately **detection only**. It does not delete anything on
either side automatically. An orphaned container might be something a
developer is deliberately debugging outside the platform's normal flow;
auto-deleting it because the platform doesn't recognize it is a good way
to destroy someone's work. A human reviews findings and decides.

Transient states (`queued`, `dispatching`, `destroy_queued`) are
excluded from comparison on purpose — an environment mid-provision or
mid-destroy is *expected* to briefly disagree with Incus, and that's not
a finding.

---

## 11. Failure modes

What actually happens, traced through the real code, not aspirational:

**The self-hosted runner dies mid-job.** GitHub Actions marks the run as
failed after its own timeout. The deployment's status stays wherever it
was (typically `dispatching`) with no `complete` callback ever arriving.
`reconcileStuckDeployments()` (part of the per-minute cron) finds
deployments stuck in `dispatching` past a timeout and requeues them with
`retry_count` incremented, using `original_status` to know whether it
was a provision or a destroy so it re-dispatches the right workflow.
This is the same mechanism that recovers from...

**A `workflow_dispatch` call to GitHub's API fails** (rate limited,
transient network error, etc). The dispatch function checks
`response.ok` and, on failure, logs a `dispatch_failed` deployment event
and returns an error — the deployment is left in whatever state it was
before dispatch, generally still `queued`, and gets picked up again by
the next cron tick or the next `waitUntil()`-triggered dispatch from any
subsequent API call. Not instant, but not lost.

**GitHub itself is unavailable.** Nothing dispatches until it recovers.
D1 state doesn't corrupt — deployments just sit `queued` longer than
usual. No special handling needed; the existing retry path covers it
once GitHub is back.

**`tofu apply` / `tofu destroy` crashes or errors.** The GitHub Actions
step fails, the workflow's `Notify failure` step posts a
`provision_failed` / `destroy_failed` event, and the deployment is left
for `reconcileStuckDeployments()` to retry (up to a retry limit — after
that it's marked permanently failed, see step ⑬ /
`reconcileStuckDeployments`'s `original_status`-based branch for
correctly marking a failed *destroy* as `destroyed` rather than
`failed`, since the resource may already be gone even if the OpenTofu
run itself errored).

**SSH is unreachable after provisioning.** `Wait for SSH` retries for a
bounded number of attempts (currently 30 × 10s) before failing the job —
same recovery path as any other provision failure.

**Bootstrap partially fails** (one script in the chain errors). The
`Run bootstrap scripts` step fails outright — there's no per-script
partial-success state. On retry, every script in the chain runs again
from the top. This is exactly why bootstrap idempotency (§13) isn't
optional: a partial failure followed by a full retry means every script,
including ones that already succeeded, will run at least twice in
practice.

**The runner's callback to the control plane never arrives** (network
blip between runner and Cloudflare, callback endpoint down, etc). Same
as the dispatch-failure case — the deployment doesn't reach `complete`,
stays in `dispatching`, gets caught and retried by
`reconcileStuckDeployments()`.

**Known gap:** `reconcileStuckDeployments()`'s recovery path has not yet
been exercised against a real failure on real infrastructure — it's
verified by code inspection, not by observed behavior in production. If
you hit a stuck deployment that doesn't recover as described here,
that's a real bug report, not expected behavior.

---

## 12. Why Cloudflare

The alternative most people reach for is "a small Go/Node server plus
Postgres, running in a Docker container somewhere." That's a perfectly
reasonable choice too. Cloudflare was picked for this project
specifically because:

- **Workers** run the control plane with zero servers to patch, scale,
  or keep alive. For a small team's usage volume, the free tier doesn't
  get close to being a real constraint.
- **D1** is SQLite at the edge — enough for this project's access
  patterns (a handful of tables, low write volume, no complex joins at
  scale) without running a separate database service.
- **R2** stores Terraform state with S3-compatible APIs (so OpenTofu's
  `s3` backend works against it unmodified) and no egress fees.
- Nothing in this stack requires you, the installer, to provision or
  maintain a server just to run the control plane — the only server you
  need is the one Incus itself runs on, which you needed anyway.

The tradeoff: you're on Cloudflare's platform and its specific
primitives (D1's SQLite dialect, Workers' execution model — no long-lived
background processes, hence the cron-based queue instead of something
like a persistent worker pool). If you'd rather self-host the control
plane too, that's a valid fork — nothing about the *rest* of the
architecture (Incus, OpenTofu, GitHub Actions runners, bootstrap
scripts) depends on Cloudflare specifically.

---

## 13. Architecture decisions

**Why GitHub Actions instead of a dedicated job queue (Nomad, etc)?**
GitHub Actions already gives you a queue, an executor, and log storage
for free, and self-hosted runners mean the executor runs on your own
infrastructure with no additional service to operate. The cost: GitHub
Actions' API has real (if generous) rate limits, and a self-hosted
runner is a single point of failure until you run more than one (§14).
For a small team's provisioning volume this tradeoff favors simplicity.

**Why D1 instead of Postgres?** D1 requires no separate database service
to run or connect to — it's bound to the Worker directly. The project's
actual data model (a handful of tables, no heavy relational querying)
doesn't need what Postgres offers over SQLite. If usage ever demands
real concurrent write throughput or complex queries, that's a real
reason to reconsider — not a decision made lightly, but not the current
bottleneck either.

**Why OpenTofu instead of Terraform?** License. OpenTofu is the
Linux-Foundation-governed fork, MIT-licensed, drop-in compatible with
existing `.tf` files and the CLI you already know. No functional
tradeoff for this project's purposes.

**Why Incus?** It needed to run on modest, ordinary hardware — a single
server, not a cluster — with no cloud account and no licensing cost.
Incus (the LXC/LXD successor maintained under the Linux Containers
project) provisions in seconds, supports cloud-init for SSH key
injection the same way cloud providers do, and its Terraform provider is
actively maintained. Proxmox was considered and is still on the roadmap
for genuine VM-level isolation; Incus was chosen first because
containers are enough for the primary use case (short-lived dev/test
environments) and the resource overhead is dramatically lower.

**Why API keys instead of OAuth?** This platform is meant to be
installed and run by a single small team, not federated across
organizations. API keys are the entire auth mechanism a small team
actually needs — no identity provider to stand up, no OAuth app to
register, no token refresh flow to implement on either side. If
multi-tenancy or SSO becomes a real requirement, that's a substantial
enough change to warrant its own design, not a bolt-on.

---

## 14. Scaling past one runner

Right now, one self-hosted runner labelled `incus-host` is a single
point of failure — if that machine or its runner process is down,
nothing provisions, destroys, or runs actions until it's back.

The tempting fix — register a second runner with the same `incus-host`
label — **does not work correctly** unless both machines share the same
Incus instance and storage. GitHub distributes jobs across runners
sharing a label with no guarantee of *which* one picks up a given job.
An environment provisioned on host A has its container, its SSH access,
and its Incus context entirely on host A — if a later action (reboot,
redeploy, destroy) for that same environment gets picked up by runner B
instead, it fails outright: the container doesn't exist there.

The correct design, when this is actually needed:

1. Give each host its own unique label (`incus-host-a`, `incus-host-b`,
   ...) instead of sharing one.
2. Store which host an environment was provisioned on (a new column on
   `environments`, e.g. `runner_label`).
3. `provision.yml`/`destroy.yml`/`action.yml` dispatch calls target that
   specific label for any operation on an existing environment, and pick
   a host (round-robin, least-loaded, whatever) only for brand new
   provisions.

This gets you horizontal scaling for provisioning *throughput* across
multiple physical hosts, while keeping every environment's full
lifecycle pinned to the host it actually lives on. Not implemented —
documented here so a naive "just add a second runner with the same
label" attempt doesn't silently corrupt environment access later.

---

## 15. Bootstrap scripts must be idempotent — no exceptions

Stated as a hard rule, not a preference: **every script in a template's
`post_provision` chain must be safe to run any number of times in a
row, in full, with no side effects beyond the first successful run.**

This isn't a nice-to-have. §11 (Failure modes) shows why: a partial
bootstrap failure means the *entire* chain re-runs on retry, not just
the script that failed. `base.sh`, `docker.sh`, `checkin.sh`, and
`install_cfzt.sh` all currently meet this bar (checked directly against
their `command -v` / `systemctl is-active` guards and, for `checkin.sh`,
deliberate dedup of its own cron entry before re-adding it). Any new
bootstrap or action script must meet it too before merging — `apt-get
install` and similar naturally-idempotent commands are fine as-is; a
script that appends to a file, creates a resource without checking it
exists, or generates a fresh secret every run is not.
