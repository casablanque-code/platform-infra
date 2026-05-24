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
  default     = "http://212.227.251.37:8080"
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
  # Генерируем случайный UUID для этого рана. Он запишется в стейт при создании.
  input = uuid()

  triggers_replace = {
    gateway_url   = var.gateway_url
    resource_type = var.resource_type
  }

  # ── Create ────────────────────────────────────────────────────────────────────
  provisioner "local-exec" {
    when        = create
    interpreter = ["/bin/bash", "-c"]
    command     = <<-BASH
      set -euo pipefail
      GATEWAY="${self.triggers_replace.gateway_url}"
      TYPE="${self.triggers_replace.resource_type}"
      RUN_TOKEN="${self.output}"

      if [ -z "$GATEWAY" ]; then
        echo "gateway_url not set, skipping mock provisioning"
        exit 0
      fi

      echo "→ Creating resource type=$TYPE on $GATEWAY with client token $RUN_TOKEN..."
      
      # Отправляем запрос. Мы передаем RUN_TOKEN в поле client_token.
      # Если твой Go-шлюз сам генерирует ID (например, res-9603), мы заставим его 
      # привязать этот ID к нашему RUN_TOKEN, который лежит в S3 стейте!
      RESPONSE=$(curl -s -X POST "$GATEWAY/v1/resources" \
        -H "Content-Type: application/json" \
        -d "{\"type\":\"$TYPE\", \"client_token\":\"$RUN_TOKEN\"}")

      RESOURCE_ID=$(echo "$RESPONSE" | jq -r '.id // empty')
      if [ -z "$RESOURCE_ID" ] || [ "$RESOURCE_ID" = "null" ]; then
        echo "Error: Gateway returned invalid response: $RESPONSE"
        exit 1
      fi

      echo "Gateway allocated ID: $RESOURCE_ID for token: $RUN_TOKEN"

      # Цикл ожидания статуса running
      ATTEMPTS=0
      while [ $ATTEMPTS -lt 20 ]; do
        sleep 2
        STATUS=$(curl -s "$GATEWAY/v1/resources/$RESOURCE_ID" | jq -r '.status // "unknown"')
        echo "Resource $RESOURCE_ID status: $STATUS"
        if [ "$STATUS" = "running" ]; then
          break
        fi
        ATTEMPTS=$((ATTEMPTS + 1))
      done

      echo "→ Resource $RESOURCE_ID is running"
    BASH
  }

  # ── Destroy ───────────────────────────────────────────────────────────────────
  provisioner "local-exec" {
    when        = destroy
    interpreter = ["/bin/bash", "-c"]
    command     = <<-BASH
      set -euo pipefail
      GATEWAY="${self.triggers_replace.gateway_url}"
      RUN_TOKEN="${self.output}" # UUID гарантированно скачается из S3 стейта!

      if [ -z "$GATEWAY" ] || [ -z "$RUN_TOKEN" ]; then
        echo "No gateway or token, skipping mock destroy"
        exit 0
      fi

      echo "→ Requesting destroy from gateway for client token $RUN_TOKEN..."

      # Шаг 1: Так как шлюз генерирует случайный ID, мы сначала спрашиваем у шлюза 
      # реальный ID ресурса, который привязан к нашему уникальному RUN_TOKEN.
      # Для этого делаем GET-запрос в список ресурсов.
      RESOURCES_LIST=$(curl -s "$GATEWAY/v1/resources" || echo "[]")
      
      # Ищем в списке строку, у которой client_token равен нашему UUID из стейта
      RESOURCE_ID=$(echo "$RESOURCES_LIST" | jq -r ".[] | select(.client_token==\"$RUN_TOKEN\") | .id" | head -n 1)

      if [ -z "$RESOURCE_ID" ] || [ "$RESOURCE_ID" = "null" ]; then
        echo "No active resource found on gateway for token $RUN_TOKEN. Already deleted?"
        exit 0
      fi

      echo "→ Found exact match! Destroying resource $RESOURCE_ID..."
      
      # Шаг 2: Удаляем СТРОГО найденный ID
      curl -s -X POST "$GATEWAY/v1/resources/delete" \
        -H "Content-Type: application/json" \
        -d "{\"id\":\"$RESOURCE_ID\"}"

      echo "→ Resource $RESOURCE_ID successfully destroyed"
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
  
  public_ip = var.static_ip != "" ? var.static_ip : "203.0.113.1"
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
  value = var.static_ip != "" ? tls_private_key.env_key.public_key_openssh : ""
}

output "ssh_private_key" {
  value     = tls_private_key.env_key.private_key_openssh
  sensitive = true
}

output "mock_resource_id" {
  value = var.gateway_url != "" ? "see gateway dashboard" : "mock-skipped"
}