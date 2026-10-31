variable "ssh_keys" {
  description = "Namen der in Hetzner hinterlegten SSH-Schlüssel für den Admin-Zugang"
  type        = list(string)
}

variable "admin_ips" {
  description = "IP-Bereiche, aus denen SSH erlaubt ist (z. B. Büro, VPN)"
  type        = list(string)
}

# Geteilte vCPUs (CX) reichen für unser Volumen; Hochstufen geht später per
# Änderung des Servertyps in wenigen Minuten. Dedizierte CCX kosten seit 15.06.2026
# ein Vielfaches (Preisliste Oktober 2026: CX33 8,49 €, CCX23 85,99 € je Monat).
variable "app_server_type" {
  description = "Servertyp für App und Worker"
  type        = string
  default     = "cx33"
}

variable "db_server_type" {
  description = "Servertyp für PostgreSQL primär und Replikat"
  type        = string
  default     = "cx33"
}

# Klaus braucht wenig: Node-Dienst und Caddy. Kosten-OK Christian 31.10.2026 (rund 5 € im Monat).
variable "bot_server_type" {
  description = "Servertyp für den Teams-Bot Klaus"
  type        = string
  default     = "cx23"
}

variable "db_volume_size" {
  description = "Größe der Datenbank-Volumes in GB (lässt sich später vergrößern, nicht verkleinern)"
  type        = number
  default     = 50
}

variable "image" {
  type    = string
  default = "debian-13"
}
