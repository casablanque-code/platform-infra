terraform {
  required_version = ">= 1.6.0"
}

output "db_host" {
  value = "postgres.internal"
}

output "db_port" {
  value = 5432
}
