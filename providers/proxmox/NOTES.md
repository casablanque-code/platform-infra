# Proxmox provider — not yet implemented

To implement:

1. Write `templates/<template>/tofu/proxmox.tf` (or a `providers/proxmox/tofu/`
   shared module, mirroring the Incus one) using the
   [`telmate/proxmox`](https://registry.terraform.io/providers/Telmate/proxmox)
   or [`bpg/proxmox`](https://registry.terraform.io/providers/bpg/proxmox)
   provider. `bpg/proxmox` is more actively maintained as of 2026.

2. Outputs must match what `runtime.json` and bootstrap scripts expect:
   `public_ip`, `ssh_user`, `ssh_port`, `ssh_public_key`, `ssh_private_key`.
   Use cloud-init (Proxmox supports it natively for VM templates) to inject
   the SSH key, same pattern as the Incus module.

3. Fill in `provider.json` → `runtime.tfvars` with whatever's static
   (e.g. default node, storage pool, template VM ID to clone from).

4. Add a `setup_proxmox()` function in `setup.sh` mirroring `setup_incus()` —
   reads `platform.config.yml`'s `proxmox:` section, validates required
   fields, sets PROXMOX_* GitHub secrets.

5. Update `provision.yml`/`destroy.yml`/`action.yml` tfvars generation if
   Proxmox needs different variables than Incus does (currently they're
   shared in one jq block — may need to branch by provider).

6. Set `"implemented": true` in provider.json once done.
