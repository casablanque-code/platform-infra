terraform {
  required_version = ">= 1.6.0"

  backend "s3" {
    # Injected via -backend-config flags in GitHub Actions workflow
  }
}

# ── Variables ──────────────────────────────────────────────────────────────────

variable "gateway_url" {
  type        = string
  description = "URL of the infra-mock-gateway (e.g. http://host:8080)"
  default     = ""
}

variable "resource_type" {
  type    = string
  default = "docker_host"
}

# Standard provider vars — ИСПРАВЛЕНО: Полностью убрали точки с запятой из всех блоков
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

terraform {
  required_providers {
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
  }
}

# ── Mock resource via gateway ──────────────────────────────────────────────────

resource "terraform_data" "mock_server" {
  triggers_replace = {
    gateway_url   = var.gateway_url
    resource_type = var.resource_type
  }

  # Сохраняем URL шлюза в стейт ресурса, чтобы прочитать его при destroy через self.output
  input = var.gateway_url

  # ── Create ────────────────────────────────────────────────────────────────────
  provisioner "local-exec" {
    when       = create
    command    = <<-BASH
      set -euo pipefail

      GATEWAY="${var.gateway_url}"
      TYPE="${var.resource_type}"

      if [ -z "$GATEWAY" ]; then
        echo "gateway_url not set, skipping mock provisioning"
        echo "mock-skipped" > /tmp/mock_resource_id.txt
        exit 0
      fi

      echo "→ Creating resource type=$TYPE on $GATEWAY..."

      RESPONSE=$(curl -sf -X POST "$GATEWAY/v1/resources" \
        -H "Content-Type: application/json" \
        -H "X-Chaos-Failure: true" \
        -H "X-Chaos-Latency: true" \
        -d "{\"type\":\"$TYPE\"}")

      RESOURCE_ID=$(echo "$RESPONSE" | jq -r '.id')
      IP=$(echo "$RESPONSE" | jq -r '.ip')

      echo "→ Resource accepted: id=$RESOURCE_ID ip=$IP"
      echo "→ Polling until status=running..."

      ATTEMPTS=0
      while [ $ATTEMPTS -lt 20 ]; do
        sleep 2
        STATUS_RESP=$(curl -sf "$GATEWAY/v1/resources/$RESOURCE_ID" \
          -H "X-Chaos-Failure: true" \
          -H "X-Chaos-Latency: true" 2>/dev/null || echo '{"status":"error"}')

        STATUS=$(echo "$STATUS_RESP" | jq -r '.status // "error"')
        echo "  attempt $ATTEMPTS: status=$STATUS"

        if [ "$STATUS" = "running" ]; then
          echo "→ Resource $RESOURCE_ID is RUNNING at $IP"
          # Store for destroy step
          echo "$RESOURCE_ID" > /tmp/mock_resource_id.txt
          echo "$IP" > /tmp/mock_resource_ip.txt
          exit 0
        fi

        ATTEMPTS=$((ATTEMPTS + 1))
	  done

      echo "→ Timeout waiting for resource to become running"
      exit 1
    BASH
  }

  # ── Destroy ───────────────────────────────────────────────────────────────────
  provisioner "local-exec" {
    when    = destroy
    command = <<-BASH
      set -euo pipefail

      # Используем безопасный self.output вместо var.gateway_url
      GATEWAY="${self.output}"

      if [ -z "$GATEWAY" ] || [ ! -f /tmp/mock_resource_id.txt ]; then
        echo "No gateway or resource ID file, skipping mock destroy"
        exit 0
      fi

      RESOURCE_ID=$(cat /tmp/mock_resource_id.txt)

      if [ "$RESOURCE_ID" = "mock-skipped" ]; then
        echo "Resource was skipped, nothing to destroy"
        exit 0
      fi

      echo "→ Deleting resource $RESOURCE_ID from $GATEWAY..."

      curl -sf -X POST "$GATEWAY/v1/resources/delete" \
        -H "Content-Type: application/json" \
        -d "{\"id\":\"$RESOURCE_ID\"}"

      rm -f /tmp/mock_resource_id.txt /tmp/mock_resource_ip.txt
      echo "→ Resource $RESOURCE_ID destroyed"
    BASH
  }
}

# ── Locals ────────────────────────────────────────────────────────────────────

locals {
  resolved_region = coalesce(var.region, var.location, "mock")
  resolved_size   = coalesce(
    var.instance_type, var.vm_size, var.machine_type,
    var.shape, var.server_type, var.platform_id, "mock"
  )
  public_ip = var.static_ip != "" ? var.static_ip : "10.100.0.1"
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

output "mock_resource_id" {
  value = var.gateway_url != "" ? "see gateway dashboard" : "mock-skipped"
}