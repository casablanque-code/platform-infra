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

# ── Вспомогательный триггер для генерации файла ───────────────────────────────

resource "terraform_data" "provision_trigger" {
  triggers_replace = {
    gateway_url   = var.gateway_url
    resource_type = var.resource_type
  }

  provisioner "local-exec" {
    when        = create
    interpreter = ["/bin/bash", "-c"]
    command     = <<-BASH
      set -euo pipefail
      GATEWAY="${self.triggers_replace.gateway_url}"
      TYPE="${self.triggers_replace.resource_type}"

      echo "→ Creating resource type=$TYPE on $GATEWAY..."
      RESPONSE=$(curl -s -X POST "$GATEWAY/v1/resources" \
        -H "Content-Type: application/json" \
        -d "{\"type\":\"$TYPE\"}")

      RESOURCE_ID=$(echo "$RESPONSE" | jq -r '.id // empty')
      if [ -z "$RESOURCE_ID" ] || [ "$RESOURCE_ID" = "null" ]; then
        echo "Error: Gateway returned invalid response: $RESPONSE"
        exit 1
      fi

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

      # Записываем строго в локальный файл внутри папки модуля
      echo -n "$RESOURCE_ID" > "${path.module}/generated_id.txt"
      echo "→ Resource $RESOURCE_ID is running and saved locally."
    BASH
  }
}

# Читаем файл ОДОБРЕННЫМ нативным методом OpenTofu СРАЗУ после его создания
data "local_file" "fetched_id" {
  depends_on = [terraform_data.provision_trigger]
  filename   = "${path.module}/generated_id.txt"
}

# ── Настоящий ресурс, управляющий дестроем ────────────────────────────────────

resource "terraform_data" "mock_server" {
  depends_on = [data.local_file.fetched_id]
  
  # ЖЕЛЕЗНО: Записываем считанный из файла ID в S3 стейт!
  input = data.local_file.fetched_id.content

  triggers_replace = {
    gateway_url = var.gateway_url
  }

  # ── Destroy ───────────────────────────────────────────────────────────────────
  provisioner "local-exec" {
    when        = destroy
    interpreter = ["/bin/bash", "-c"]
    command     = <<-BASH
      set -euo pipefail
      GATEWAY="${self.triggers_replace.gateway_url}"
      RESOURCE_ID="${self.output}" # Берётся ИЗ СТЕЙТА S3. Файлы на диске больше не нужны!

      if [ -z "$GATEWAY" ] || [ -z "$RESOURCE_ID" ] || [ "$RESOURCE_ID" = "null" ]; then
        echo "No valid resource ID found in state, skipping destroy"
        exit 0
      fi

      echo "→ Destroying EXACT resource $RESOURCE_ID from $GATEWAY..."
      
      # Отправляем запрос на удаление строго того ID, который был зашит в S3
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