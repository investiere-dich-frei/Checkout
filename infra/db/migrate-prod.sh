#!/usr/bin/env bash
# Spielt die Migrationen aus packages/db in die Produktionsdatenbank auf db-nbg1 ein.
# Läuft auf dem Mac mini: Die Datenbank ist von außen nicht erreichbar, deshalb geht
# die Verbindung durch einen SSH-Tunnel auf localhost:5432 des Servers.
# Das Passwort kommt aus SOPS und erscheint weder auf dem Bildschirm noch im Verlauf.
#
# Aufruf aus dem Repo-Wurzelverzeichnis:  infra/db/migrate-prod.sh
set -euo pipefail

host=root@2.31.93.148
key=~/.ssh/idf_server
local_port=15432
secrets=infra/ansible/inventories/prod/group_vars/db/secrets.sops.yml

password=$(sops -d --extract '["pg_migrator_password"]' "$secrets")

ssh -i "$key" -o ExitOnForwardFailure=yes -f -N -M -S /tmp/idf-migrate.sock \
  -L "$local_port:localhost:5432" "$host"
trap 'ssh -S /tmp/idf-migrate.sock -O exit "$host" 2>/dev/null' EXIT

DATABASE_URL="postgres://idf_migrator:${password}@localhost:${local_port}/idf" pnpm db:migrate
