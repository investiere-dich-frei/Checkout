# Live in Nürnberg (NBG1), Replikat in Falkenstein (FSN1).
# Beide Standorte liegen in Deutschland und im selben Hetzner-Netzwerk (eu-central).

locals {
  labels = { projekt = "idf-checkout", umgebung = "prod" }
}

resource "hcloud_network" "main" {
  name     = "idf-checkout"
  ip_range = "10.20.0.0/16"
  labels   = local.labels
}

resource "hcloud_network_subnet" "main" {
  network_id   = hcloud_network.main.id
  type         = "cloud"
  network_zone = "eu-central"
  ip_range     = "10.20.1.0/24"
}

resource "hcloud_firewall" "web" {
  name   = "idf-checkout-web"
  labels = local.labels

  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "443"
    source_ips = ["0.0.0.0/0", "::/0"]
  }
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "80"
    source_ips = ["0.0.0.0/0", "::/0"]
  }
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "22"
    source_ips = var.admin_ips
  }
}

# Datenbank-Server sind von außen nur per SSH aus den Admin-Netzen erreichbar.
resource "hcloud_firewall" "db" {
  name   = "idf-checkout-db"
  labels = local.labels

  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "22"
    source_ips = var.admin_ips
  }
}

resource "hcloud_server" "app" {
  name         = "app-nbg1"
  server_type  = var.app_server_type
  image        = var.image
  location     = "nbg1"
  ssh_keys     = var.ssh_keys
  firewall_ids = [hcloud_firewall.web.id]
  labels       = merge(local.labels, { rolle = "app" })
  backups      = false # Sicherung läuft über pgBackRest/restic, nicht über Server-Snapshots

  network {
    network_id = hcloud_network.main.id
    ip         = "10.20.1.10"
  }
  depends_on = [hcloud_network_subnet.main]
}

resource "hcloud_server" "db_primary" {
  name         = "db-nbg1"
  server_type  = var.db_server_type
  image        = var.image
  location     = "nbg1"
  ssh_keys     = var.ssh_keys
  firewall_ids = [hcloud_firewall.db.id]
  labels       = merge(local.labels, { rolle = "db-primary" })

  network {
    network_id = hcloud_network.main.id
    ip         = "10.20.1.20"
  }
  depends_on = [hcloud_network_subnet.main]
}

resource "hcloud_server" "db_replica" {
  name         = "db-fsn1"
  server_type  = var.db_server_type
  image        = var.image
  location     = "fsn1"
  ssh_keys     = var.ssh_keys
  firewall_ids = [hcloud_firewall.db.id]
  labels       = merge(local.labels, { rolle = "db-replica" })

  network {
    network_id = hcloud_network.main.id
    ip         = "10.20.1.21"
  }
  depends_on = [hcloud_network_subnet.main]
}

# Getrennte Datenträger für die Datenbank, damit ein Server-Neuaufbau die Daten nicht berührt.
resource "hcloud_volume" "db_primary" {
  name      = "db-nbg1-data"
  size      = 100
  server_id = hcloud_server.db_primary.id
  format    = "ext4"
  labels    = local.labels
}

resource "hcloud_volume" "db_replica" {
  name      = "db-fsn1-data"
  size      = 100
  server_id = hcloud_server.db_replica.id
  format    = "ext4"
  labels    = local.labels
}
