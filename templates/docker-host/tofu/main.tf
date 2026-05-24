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

  # Переносим логику создания ID на уровень OpenTofu. 
  # Если ваш API шлюз возвращает ID, который нельзя предугадать, 
  # local-exec provisioner, к сожалению, не умеет мутировать state ресурса напрямую.
  # Поэтому для полноценного stateless-подхода лучше передавать уникальное имя/тег 
  # на базе ID самого рана GitHub Actions, чтобы дестрой мог найти ресурс по этому тегу.
  
  input = {
    gateway_url = var.gateway_url
    run_id      = "run-${id}" # Пример уникального ключа, если применимо
  }

  # ── Create ────────────────────────────────────────────────────────────────────
  provisioner "local-exec" {
    when    = create
    command = <<-BASH
      set -euo pipefail
      GATEWAY="${self.triggers_replace.gateway_url}"
      TYPE="${self.triggers_replace.resource_type}"

      if [ -z "$GATEWAY" ]; then
        echo "gateway_url not set, skipping mock provisioning"
        exit 0
      fi

      echo "→ Creating resource type=$TYPE on $GATEWAY..."
      
      # Вместо записи в /tmp, отправляем запрос. 
      # Если шлюз позволяет задавать клиентский ID или имя ресурса, передавайте его туда.
      RESPONSE=$(curl -sf -X POST "$GATEWAY/v1/resources" \
        -H "Content-Type: application/json" \
        -d "{\"type\":\"$TYPE\"}")
    BASH
  }

  # ── Destroy ───────────────────────────────────────────────────────────────────
  provisioner "local-exec" {
    when    = destroy
    command = <<-BASH
      set -euo pipefail
      GATEWAY="${self.triggers_replace.gateway_url}"

      if [ -z "$GATEWAY" ]; then
        echo "No gateway, skipping mock destroy"
        exit 0
      fi

      echo "→ Deleting resource from $GATEWAY..."
      
      # ИСПРАВЛЕНИЕ: Так как ID из файла /tmp недоступен, реализуйте на шлюзе метод 
      # очистки по типу ресурса или по метаданным, которые известны OpenTofu изначально.
      curl -sf -X POST "$GATEWAY/v1/resources/delete" \
        -H "Content-Type: application/json" \
        -d "{\"type\":\"${self.triggers_replace.resource_type}\"}"
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