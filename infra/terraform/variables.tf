variable "ssh_keys" {
  description = "Namen der in Hetzner hinterlegten SSH-Schlüssel für den Admin-Zugang"
  type        = list(string)
}

variable "admin_ips" {
  description = "IP-Bereiche, aus denen SSH erlaubt ist (z. B. Büro, VPN)"
  type        = list(string)
}

variable "app_server_type" {
  description = "Servertyp für App und Worker (vor dem Anlegen mit der aktuellen Hetzner-Preisliste abgleichen)"
  type        = string
  default     = "ccx13"
}

variable "db_server_type" {
  description = "Servertyp für PostgreSQL primär und Replikat"
  type        = string
  default     = "ccx23"
}

variable "image" {
  type    = string
  default = "debian-13"
}
