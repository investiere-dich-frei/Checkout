#!/usr/bin/env bash
# Führt ein pnpm-Skript gegen die Produktionsdatenbank auf db-nbg1 aus.
# Läuft auf dem Mac mini: Die Datenbank ist von außen nicht erreichbar, deshalb geht
# die Verbindung durch einen SSH-Tunnel auf localhost:5432 des Servers.
# Das Passwort kommt aus SOPS und erscheint weder auf dem Bildschirm noch im Verlauf.
#
# Aufruf aus dem Repo-Wurzelverzeichnis, Dateien mit absolutem Pfad, z. B.:
#   infra/db/run-prod.sh db:migrate
#   infra/db/run-prod.sh db:company:create ~/gesellschaft.json --actor cli:christian --dry-run
#   infra/db/run-prod.sh db:thrivecart:import ~/katalog.json --company <id> --dry-run
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Aufruf: infra/db/run-prod.sh <pnpm-skript> [argumente …]" >&2
  exit 1
fi

host=root@2.31.93.148
key=~/.ssh/idf_server
local_port=15432
socket=/tmp/idf-prod-$$.sock
secrets=infra/ansible/inventories/prod/group_vars/db/secrets.sops.yml

password=$(sops -d --extract '["pg_migrator_password"]' "$secrets")

# Lesezugang zum Supabase-Spiegel für den Altdaten-Import, falls hinterlegt.
db_secrets=infra/db/secrets.sops.yml
if [ -f "$db_secrets" ]; then
  SOURCE_DATABASE_URL=$(sops -d --extract '["supabase_readonly_url"]' "$db_secrets")
  # Supabase signiert mit einer eigenen Root-CA, die nicht im System-Truststore liegt.
  # Mit ihr wird das Zertifikat des Poolers vollständig geprüft (Kette und Hostname).
  ca="$PWD/infra/db/supabase-prod-ca-2021.crt"
  SOURCE_DATABASE_URL="${SOURCE_DATABASE_URL/sslmode=require/sslmode=verify-full}"
  case "$SOURCE_DATABASE_URL" in
    *\?*) SOURCE_DATABASE_URL="${SOURCE_DATABASE_URL}&sslrootcert=${ca}" ;;
    *) SOURCE_DATABASE_URL="${SOURCE_DATABASE_URL}?sslmode=verify-full&sslrootcert=${ca}" ;;
  esac
  export SOURCE_DATABASE_URL
fi

ssh -i "$key" -o ExitOnForwardFailure=yes -f -N -M -S "$socket" \
  -L "$local_port:localhost:5432" "$host"
trap 'ssh -S "$socket" -O exit "$host" 2>/dev/null' EXIT

DATABASE_URL="postgres://idf_migrator:${password}@localhost:${local_port}/idf" pnpm "$@"
