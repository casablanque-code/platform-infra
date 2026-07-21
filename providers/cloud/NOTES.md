# Cloud provider — not yet implemented

To implement (using Hetzner as the first target — cheapest, simplest API):

1. Write `templates/<template>/tofu/hetzner.tf` using the
   [`hetznercloud/hcloud`](https://registry.terraform.io/providers/hetznercloud/hcloud)
   provider. cx22 (~€3/mo) is the cheapest useful instance type.

2. Same output contract as Incus: `public_ip`, `ssh_user`, `ssh_port`,
   `ssh_public_key`, `ssh_private_key`. Hetzner supports `user_data` for
   cloud-init, same SSH key injection pattern.

3. `provider.json` → `runtime.tfvars`: default server_type, location,
   image.

4. `setup.sh`: add `setup_cloud()`, reads `platform.config.yml`'s `cloud:`
   section (`vendor`, `api_token`, `region`), sets CLOUD_* secrets. Since
   this is a real API (not local), a self-hosted runner isn't required —
   could fall back to `ubuntu-latest` for this provider type specifically.

5. Consider: this is the one provider type where the GitHub-hosted runner
   (not self-hosted) is viable again, since there's no local network to
   reach. May need provision.yml to pick runs-on dynamically by provider,
   or maintain a separate cloud-provision.yml.

6. Set `"implemented": true` in provider.json once done.
