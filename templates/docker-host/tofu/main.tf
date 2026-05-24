terraform {
  required_version = ">= 1.6.0"

  required_providers {
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
  }

  backend "s3" {
    # Injected via -backend-config flags in GitHub Actions workflow
  }
}

# ── Variables ──────────────────────────────────────────────────────────────────

variable "gateway_url" {
  type        = string
  description = "URL of infra-mock-gateway (e.g. http://host:8080)"
  default     = ""
}

variable "environment_id" {
  type        = string
  description = "Platform environment ID — used to tag and find gateway resources"
  default     = ""
}

variable "resource_type" {
  type    = string
  default = "docker_host"
}

variable "region" {
  type    = string
  default = ""
}

variable "shape" {
  type    = string
  default = ""
}

variable "location" {
  type    = string
  default = ""
}

variable "server_type" {
  type    = string
  default = ""
}

variable "instance_type" {
  type    = string
  default = ""
}

variable "vm_size" {
  type    = string
  default = ""
}

variable "machine_type" {
  type    = string
  default = ""
}

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

variable "static_ip" {
  type    = string
  default = ""
}

variable "ssh_user" {
  type    = string
  default = "root"
}

# ── Per-environment SSH key ────────────────────────────────────────────────────

resource "tls_private_key" "env_key" {
  algorithm = "ED25519"
}

# ── Mock resource via gateway ──────────────────────────────────────────────────
# environment_id and gateway_url stored in triggers_replace
# so destroy provisioner can access them via self.triggers_replace

resource "terraform_data" "mock_server" {
  triggers_replace = {
    gateway_url    = var.gateway_url
    environment_id = var.environment_id
    resource_type  = var.resource_type
  }

  # ── Create ────────────────────────────────────────────────────────────────────
  provisioner "local-exec" {
    when        = create
    interpreter = ["/bin/bash", "-c"]
    command     = <<-BASH
      set -euo pipefail

      GATEWAY="${var.gateway_url}"
      TYPE="${var.resource_type}"
      ENV_ID="${var.environment_id}"

      if [ -z "$GATEWAY" ]; then
        echo "gateway_url not set, skipping"
        exit 0
      fi

      echo "Creating resource type=$TYPE env=$ENV_ID on $GATEWAY..."

      RESPONSE=$(curl -sf -X POST "$GATEWAY/v1/resources" \
        -H "Content-Type: application/json" \
        -H "X-Chaos-Failure: true" \
        -H "X-Chaos-Latency: true" \
        -d "{\"type\":\"$TYPE\",\"environment_id\":\"$ENV_ID\"}")

      RESOURCE_ID=$(echo "$RESPONSE" | jq -r '.id')
      IP=$(echo "$RESPONSE" | jq -r '.ip')

      echo "Resource accepted: id=$RESOURCE_ID ip=$IP"
      echo "Polling until running..."

      ATTEMPTS=0
      while [ $ATTEMPTS -lt 20 ]; do
        sleep 2
        STATUS=$(curl -sf "$GATEWAY/v1/resources/$RESOURCE_ID" \
          -H "X-Chaos-Failure: true" \
          -H "X-Chaos-Latency: true" 2>/dev/null \
          | jq -r '.status // "error"')

        echo "  attempt $ATTEMPTS: status=$STATUS"

        if [ "$STATUS" = "running" ]; then
          echo "Resource $RESOURCE_ID RUNNING at $IP"
          exit 0
        fi

        ATTEMPTS=$((ATTEMPTS + 1))
      done

      echo "Timeout waiting for resource"
      exit 1
    BASH
  }

  # ── Destroy ───────────────────────────────────────────────────────────────────
  provisioner "local-exec" {
    when        = destroy
    interpreter = ["/bin/bash", "-c"]
    command     = <<-BASH
      set -euo pipefail

      GATEWAY="${self.triggers_replace["gateway_url"]}"
      ENV_ID="${self.triggers_replace["environment_id"]}"

      if [ -z "$GATEWAY" ]; then
        echo "No gateway_url, skipping"
        exit 0
      fi

      echo "Deleting resources for env=$ENV_ID from $GATEWAY..."

      curl -sf -X POST "$GATEWAY/v1/resources/delete" \
        -H "Content-Type: application/json" \
        -d "{\"environment_id\":\"$ENV_ID\"}"

      echo "Resources for $ENV_ID destroyed"
    BASH
  }
}

# ── Locals ────────────────────────────────────────────────────────────────────

locals {
  resolved_region = coalesce(var.region, var.location, "mock")
  resolved_size = coalesce(
    var.instance_type,
    var.vm_size,
    var.machine_type,
    var.shape,
    var.server_type,
    var.platform_id,
    "mock"
  )
  public_ip = var.static_ip != "" ? var.static_ip : "203.0.113.10"
}

# ── Outputs ───────────────────────────────────────────────────────────────────

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

output "ssh_public_key" {
  value = tls_private_key.env_key.public_key_openssh
}

output "ssh_private_key" {
  value     = tls_private_key.env_key.private_key_openssh
  sensitive = true
}
