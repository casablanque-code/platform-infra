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

# ── Postgres config ────────────────────────────────────────────────────────────
variable "db_name" {
  type    = string
  default = "app"
}

variable "db_user" {
  type    = string
  default = "postgres"
}

# ── Mock outputs ───────────────────────────────────────────────────────────────
# Replace with real RDS/Cloud SQL/etc resource when provider is available.

locals {
  # Deterministic mock password derived from db_name + user.
  # Not secure — replace with random_password resource when real.
  mock_password = "mock-${var.db_name}-${var.db_user}-secret"
}

output "db_host" {
  value = "postgres.internal"
}

output "db_port" {
  value = 5432
}

output "db_name" {
  value = var.db_name
}

output "db_user" {
  value = var.db_user
}

output "db_password" {
  value     = local.mock_password
  sensitive = true
}

output "db_url" {
  value     = "postgresql://${var.db_user}:${local.mock_password}@postgres.internal:5432/${var.db_name}"
  sensitive = true
}

output "region" {
  value = var.region != "eu-frankfurt-1" ? var.region : var.location
}
