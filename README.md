# platform-infra

[![CI](https://github.com/casablanque-code/platform-infra/actions/workflows/ci.yml/badge.svg)](https://github.com/casablanque-code/platform-infra/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/casablanque-code/platform-infra?label=release)](https://github.com/casablanque-code/platform-infra/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-cbff4d.svg)](LICENSE)

Self-service infrastructure for small teams. One sysadmin sets it up once;
developers get their own test/dev machines through a web dashboard —
no more "hey can you spin up a VM for me."

→ [Landing](https://landing.platform.casablanque.com) · [Dashboard](https://platform.casablanque.com)

---

Runs entirely on your own hardware. No cloud account required, no per-minute
billing, no vendor lock-in.

## What it is

- **Control plane** — Cloudflare Workers + D1 + R2 (free tier is enough for
  small teams). Handles auth, RBAC, environment lifecycle, audit log.
- **Executor** — GitHub Actions, running on a self-hosted runner on your own
  infrastructure. Provisions with OpenTofu, configures with shell scripts
  over SSH.
- **Dashboard** — a small React app. Create environments, run actions
  (reboot, install services, backups), see who did what.
- **Provider** — [Incus](https://linuxcontainers.org/incus/) (LXC containers)
  today. Proxmox and public cloud are on the roadmap — see below.

## Requirements

- A Linux server (or VM) for Incus — **needs real KVM/hardware virtualization,
  not an OpenVZ/container-based VPS**. Check with `systemd-detect-virt` and
  confirm `/dev/kvm` exists before you start; Incus will not run without it.
- 2GB+ RAM recommended. It technically starts on less, but you won't have
  room for more than one or two guest environments.
- A GitHub repo (fork or clone this one) and a Cloudflare account, both free.

## Quick start

```bash
git clone https://github.com/<you>/platform-infra.git
cd platform-infra
cp platform.config.example.yml platform.config.yml
```

Edit `platform.config.yml`:
- `provider.type: incus`
- Leave `incus.remote_addr` blank if you're running `setup.sh` on the same
  machine you want Incus on — it'll install and configure Incus for you.
- Fill in `cloudflare.*` and `github.*` (see comments in the file for exact
  steps — D1 database, R2 bucket, GitHub PAT).
- Generate the three `secrets.*` values with `openssl rand -hex 32`.

Then:

```bash
sudo bash setup.sh
```

This deploys the control plane, sets all secrets, and (for Incus) installs
and configures everything needed on the current machine. At the end it
prints the command to register your self-hosted GitHub Actions runner —
run that on the same machine as Incus.

Open the dashboard URL it gives you, sign in with the admin key, create your
first environment.

## Providers

| Provider | Status | Notes |
|---|---|---|
| **Incus** | ✅ Working | LXC containers, runs on a single server. First and only fully implemented provider. |
| **Proxmox** | 🚧 Not implemented | Stub exists in `providers/proxmox/`, see `NOTES.md` there for what's needed. |
| **Cloud** (Hetzner etc.) | 🚧 Not implemented | Stub exists in `providers/cloud/`, see `NOTES.md` there. |

`platform.config.yml`'s `provider.type` selects which one `setup.sh` uses.
Proxmox and cloud currently fail with a clear error pointing at their
NOTES.md — they were deliberately left as stubs with a defined contract
(same tfvars/outputs shape as Incus) rather than half-implemented.

## Templates

- **docker-host** — Ubuntu container, Docker CE + Compose pre-installed.
  Actions: install Portainer, Uptime Kuma, Node Exporter.
- **postgres** — Ubuntu container, PostgreSQL pre-installed, DB + user
  created automatically, credentials saved encrypted in the control plane.
  Actions: install pgAdmin, Node Exporter, backup to R2.

Both are LXC containers on Incus — not full VMs. For most dev/test
workloads this is indistinguishable in practice (same SSH, same Docker,
same everything), but keep it in mind if you need kernel-level isolation
or non-Linux guests.

## Zero Trust access (optional)

Services installed via actions (Portainer, Uptime Kuma, pgAdmin) can be
exposed through [Cloudflare Tunnel](https://github.com/casablanque-code/cfzt)
instead of opening firewall ports. Fill in `cloudflare_tunnel.*` in
`platform.config.yml` to enable it — leave `domain` blank to skip.

SSH access for provisioning and actions always goes over your normal
network path; the tunnel only covers the services themselves.

## Roadmap

- [ ] Proxmox provider
- [ ] Cloud provider (Hetzner first)
- [ ] Test coverage — currently none; see `_archive/` for notes on what
      was here before and why it was removed
- [ ] Packaged install — today this is git clone + shell script; a single
      binary or installer script is the goal
- [ ] Template catalog — K3s, WireGuard, Redis, n8n
- [ ] Per-environment secrets management
- [ ] Multi-tenancy — project isolation, team RBAC beyond the current
      admin/operator/viewer roles

## Repository layout

```
workers/control-plane/   Cloudflare Worker — API, auth, D1 schema
apps/dashboard/           React dashboard
providers/                One folder per provider: provider.json (+ NOTES.md for stubs)
templates/                One folder per template: template.json, runtime.json, tofu/
bootstrap/                 Shell scripts run over SSH after provisioning
.github/workflows/         provision.yml, destroy.yml, action.yml
_archive/                  Retired code kept for reference (old cloud provider
                           stubs, mock gateway) — not part of the running system
```

## License

MIT
