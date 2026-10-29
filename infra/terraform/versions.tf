terraform {
  required_version = ">= 1.9"
  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.52"
    }
  }
  # Zustand liegt im privaten Bucket bei Hetzner Object Storage (S3-kompatibel), nicht im Repo.
  # Zugangsdaten kommen aus der Umgebung (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY).
  # encrypt = false: Hetzner lehnt das Feld für serverseitige Verschlüsselung (SSE-S3)
  # mit "400 InvalidArgument" ab, der State ließ sich damit nicht speichern (29.10.2026).
  backend "s3" {
    bucket                      = "idf-checkout-tfstate"
    key                         = "prod/terraform.tfstate"
    region                      = "eu-central"
    endpoints                   = { s3 = "https://nbg1.your-objectstorage.com" }
    skip_credentials_validation = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_metadata_api_check     = true
    skip_s3_checksum            = true
    use_path_style              = true
    encrypt                     = false
  }
}

provider "hcloud" {
  # HCLOUD_TOKEN aus der Umgebung.
}
