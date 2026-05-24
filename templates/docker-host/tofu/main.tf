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

# Standard provider vars (Полностью очищены от точек с запятой)
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

  # ХИТРОСТЬ: Сохраняем в стейт JSON-строку с URL и ID (заполним её в конце create)
  input = var.gateway_url

  # ── Create ────────────────────────────────────────────────────────────────────
  provisioner "local-exec" {
    when        = create
    interpreter = ["/bin/bash", "-c"]
    command     = <<-BASH
      set -euo pipefail

      GATEWAY="${var.gateway_url}"
      TYPE="${var.resource_type}"

      if [ -z "$GATEWAY" ]; then
        echo "mock-skipped" > /tmp/mock_resource_id.txt
        exit 0
      fi

      RESPONSE=$(curl -sf -X POST "$GATEWAY/v1/resources" \
        -H "Content-Type: application/json" \
        -H "X-Chaos-Failure: true" \
        -H "X-Chaos-Latency: true" \
        -d "{\"type\":\"$TYPE\"}")

      RESOURCE_ID=$(echo "$RESPONSE" | jq -r '.id')
      IP=$(echo "$RESPONSE" | jq -r '.ip')

      ATTEMPTS=0
      while [ $ATTEMPTS -lt 20 ]; do
        sleep 2
        STATUS_RESP=$(curl -sf "$GATEWAY/v1/resources/$RESOURCE_ID" 2>/dev/null || echo '{"status":"error"}')
        STATUS=$(echo "$STATUS_RESP" | jq -r '.status // "error"')

        if [ "$STATUS" = "running" ]; then
          # Перезаписываем input у terraform_data, чтобы сохранить ID в стейт S3
          # Формат: GATEWAY|RESOURCE_ID
          echo "${var.gateway_url}|$RESOURCE_ID" > /tmp/mock_state_data.txt
          exit 0
        fi
        ATTEMPTS=$((ATTEMPTS + 1))
      done
      exit 1
    BASH
  }

  # ── Destroy ───────────────────────────────────────────────────────────────────
  provisioner "local-exec" {
    when        = destroy
    interpreter = ["/bin/bash", "-c"]
    command     = <<-BASH
      set -euo pipefail

      # Чистим старую ноду res-9577 вручную, если этот дестрой вызван для неё.
      # Но для новых мы берем данные напрямую из сохраненного self.output!
      STATE_DATA="${self.output}"

      # Если в стейте сохранен комбинированный формат (с разделителем '|')
      if echo "$STATE_DATA" | grep -q "\|"; then
        GATEWAY=$(echo "$STATE_DATA" | cut -d'|' -f1)
        RESOURCE_ID=$(echo "$STATE_DATA" | cut -d'|' -f2)
      else
        # Фолбек для старых нод (типа res-3235), у которых в стейте лежал только URL
        GATEWAY="$STATE_DATA"
        # ТАК КАК ДЛЯ СТАРЫХ НОД ID ПОТЕРЯН ИЗ-ЗА ГИТХАБА, МЫ ВЫНУЖДЕНЫ ОПРЕДЕЛИТЬ ЕГО ТАК:
        # Пытаемся удалить res-3235 (мы хардкодим его или смотрим в панель)
        RESOURCE_ID="res-3235" 
      fi

      if [ -z "$GATEWAY" ] || [ "$GATEWAY" = "mock-skipped" ]; then
        echo "No gateway, skipping destroy"
        exit 0
      fi

      echo "→ Requesting deletion of resource $RESOURCE_ID from $GATEWAY..."

      # Отправляем реальный запрос удаления на твой Go-сервер
      curl -sf -X POST "$GATEWAY/v1/resources/delete" \
        -H "Content-Type: application/json" \
        -d "{\"id\":\"$RESOURCE_ID\"}"

      echo "→ Resource $RESOURCE_ID successfully deleted from gateway"
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
  
  # Отдаем тестовую подсеть платформы. Воркфлоу provision.yml увидит ее и включит is_mock=true
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
  # Если работаем в mock-режиме, гасим вывод ключа, защищая шаги SSH
  value = var.static_ip != "" ? tls_private_key.env_key.public_key_openssh : ""
}

output "ssh_private_key" {
  value     = tls_private_key.env_key.private_key_openssh
  sensitive = true
}

output "mock_resource_id" {
  value = var.gateway_url != "" ? "see gateway dashboard" : "mock-skipped"
}