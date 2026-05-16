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

# ── Resolved values ────────────────────────────────────────────────────────────
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
}

# ── Mock outputs ───────────────────────────────────────────────────────────────
# Replace with real provider resources when credentials are available.

output "public_ip" {
  value = "203.0.113.10"
}

output "private_ip" {
  value = "10.0.0.10"
}

output "region" {
  value = local.resolved_region
}

output "server_type" {
  value = local.resolved_size
}

output "ssh_user" {
  value = "ubuntu"
}

output "ssh_port" {
  value = 22
}
