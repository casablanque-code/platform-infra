terraform {
  required_version = ">= 1.6.0"
}

variable "region" {
  type = string
}

variable "shape" {
  type = string
}

output "public_ip" {
  value = "203.0.113.10"
}

output "private_ip" {
  value = "10.0.0.10"
}

output "region" {
  value = var.region
}

output "shape" {
  value = var.shape
}