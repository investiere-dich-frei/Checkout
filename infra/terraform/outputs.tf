output "app_ipv4" {
  value = hcloud_server.app.ipv4_address
}

output "db_primary_ipv4" {
  value = hcloud_server.db_primary.ipv4_address
}

output "db_replica_ipv4" {
  value = hcloud_server.db_replica.ipv4_address
}

output "bot_ipv4" {
  value = hcloud_server.bot.ipv4_address
}

output "bot_ipv6" {
  value = hcloud_server.bot.ipv6_address
}
