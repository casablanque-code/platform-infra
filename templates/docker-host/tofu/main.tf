terraform {
  required_version = ">= 1.6.0"
  required_providers {
    incus = { source = "lxc/incus", version = "~> 1.0" }
    tls   = { source = "hashicorp/tls", version = "~> 4.0" }
  }
  backend "s3" {}
}

variable "incus_remote_addr" { type = string }
variable "incus_token" {
  type      = string
  sensitive = true
}
variable "environment_id" { type = string }
variable "environment_name" {
  type    = string
  default = ""
}
variable "image" {
  type    = string
  default = "ubuntu/22.04/cloud"
}
variable "cpu" {
  type    = number
  default = 2
}
variable "memory_mb" {
  type    = number
  default = 2048
}
variable "disk_gb" {
  type    = number
  default = 20
}
variable "incus_project" {
  type    = string
  default = "default"
}

provider "incus" {
  generate_client_certificates = true
  accept_remote_certificate    = true
  remote {
    name    = "platform"
    address = var.incus_remote_addr
    token   = var.incus_token
  }
  default_remote = "platform"
}

resource "tls_private_key" "env_key" {
  algorithm = "ED25519"
}

resource "incus_instance" "node" {
  name    = "platform-${var.environment_id}"
  image   = var.image
  project = var.incus_project
  running = true

  device {
    name = "root"
    type = "disk"
    properties = {
      pool = "default"
      path = "/"
      size = "${var.disk_gb}GiB"
    }
  }

  config = {
    "limits.cpu"    = tostring(var.cpu)
    "limits.memory" = "${var.memory_mb}MiB"

    "cloud-init.user-data" = <<-CLOUDINIT
      #cloud-config
      ssh_authorized_keys:
        - ${trimspace(tls_private_key.env_key.public_key_openssh)}
    CLOUDINIT
  }
}

output "public_ip" { value = incus_instance.node.ipv4_address }
output "private_ip" { value = incus_instance.node.ipv4_address }
output "ssh_user" { value = "ubuntu" }
output "ssh_port" { value = 22 }
output "ssh_public_key" { value = tls_private_key.env_key.public_key_openssh }
output "ssh_private_key" {
  value     = tls_private_key.env_key.private_key_openssh
  sensitive = true
}
output "instance_name" { value = incus_instance.node.name }
