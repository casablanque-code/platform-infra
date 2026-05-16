terraform {
  required_version = ">= 1.6.0"

  backend "s3" {
    # All backend-config values are injected via -backend-config flags
    # in the GitHub Actions workflow. Nothing hardcoded here.
  }
}

# ── Oracle vars ────────────────────────────────────────────────────────────────
variable "region" {
  type    = string
  default = "eu-frankfurt-1"
}

variable "shape" {
  type    = string
  default = "VM.Standard.E2.1.Micro"
}

# ── Hetzner vars ───────────────────────────────────────────────────────────────
variable "location" {
  type    = string
  default = "fsn1"
}

variable "server_type" {
  type    = string
  default = "cx22"
}

# ── Mock outputs ───────────────────────────────────────────────────────────────
# Replace these with real resources when a provider is available.

output "public_ip" {
  value = "203.0.113.10"
}

output "private_ip" {
  value = "10.0.0.10"
}

output "region" {
  value = var.region != "eu-frankfurt-1" ? var.region : var.location
}

output "server_type" {
  value = var.shape != "VM.Standard.E2.1.Micro" ? var.shape : var.server_type
}

output "ssh_user" {
  value = "ubuntu"
}
