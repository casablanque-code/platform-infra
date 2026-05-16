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

# ── Postgres config ────────────────────────────────────────────────────────────
variable "db_name" {
  type    = string
  default = "app"
}

variable "db_user" {
  type    = string
  default = "postgres"
}

# ── Resolved values ────────────────────────────────────────────────────────────
locals {
  resolved_region = coalesce(var.region, var.location, "unknown")
  mock_password   = "mock-${var.db_name}-${var.db_user}-secret"
}

# ── Mock outputs ───────────────────────────────────────────────────────────────
# Replace with real RDS / Cloud SQL / etc when credentials are available.

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
  value = local.resolved_region
}
