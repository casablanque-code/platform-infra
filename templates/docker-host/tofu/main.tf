terraform {
  required_version = ">= 1.6.0"

  backend "s3" {
    # Injected via -backend-config flags in GitHub Actions workflow
  }
}

# ── Oracle ─────────────────────────────────────────────────────────────────────
variable "region" {
  type    = string
  default = ""
}
variable "shape" {
  type    = string
  default = ""
}

# ── Hetzner ────────────────────────────────────────────────────────────────────
variable "location" {
  type    = string
  default = ""
}
variable "server_type" {
  type    = string
  default = ""
}

# ── AWS ────────────────────────────────────────────────────────────────────────
variable "instance_type" {
  type    = string
  default = ""
}

# ── Azure ──────────────────────────────────────────────────────────────────────
variable "vm_size" {
  type    = string
  default = ""
}

# ── GCP ────────────────────────────────────────────────────────────────────────
variable "machine_type" {
  type    = string
  default = ""
}

# ── Yandex ─────────────────────────────────────────────────────────────────────
variable "platform_id" {
  type    = string
  default = ""
}
variable "cores" {
  type    = number
  default = 2
}
variable "memory" {
  type    = number
  default = 2
}

# ── IONOS / static existing server ─────────────────────────────────────────────
variable "static_ip" {
  type    = string
  default = ""
}
variable "ssh_user" {
  type    = string
  default = "root"
}

# ── Resolved ───────────────────────────────────────────────────────────────────
locals {
  resolved_region = coalesce(var.region, var.location, "unknown")
  resolved_size = coalesce(
    var.instance_type,
    var.vm_size,
    var.machine_type,
    var.shape,
    var.server_type,
    var.platform_id,
    "unknown"
  )
  public_ip = var.static_ip != "" ? var.static_ip : "203.0.113.10"
}

output "public_ip" {
  value = local.public_ip
}
output "private_ip" {
  value = local.public_ip
}
output "region" {
  value = local.resolved_region
}
output "server_type" {
  value = local.resolved_size
}
output "ssh_user" {
  value = var.ssh_user
}
output "ssh_port" {
  value = 22
}
