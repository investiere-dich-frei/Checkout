#!/usr/bin/env bash
# Spielt die Migrationen aus packages/db in die Produktionsdatenbank auf db-nbg1 ein.
# Tunnel und Passwort übernimmt run-prod.sh.
#
# Aufruf aus dem Repo-Wurzelverzeichnis:  infra/db/migrate-prod.sh
set -euo pipefail

exec "$(dirname "$0")/run-prod.sh" db:migrate
