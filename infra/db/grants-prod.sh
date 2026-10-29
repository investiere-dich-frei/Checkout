#!/usr/bin/env bash
# Setzt die Rechte der Anwendungsrolle idf_app in der Produktionsdatenbank
# (packages/db/grants.sql). Nach jeder Migration ausführen; wiederholbar.
# Voraussetzung: Ansible hat die Rolle idf_app angelegt (pg_app_password).
#
# Aufruf aus dem Repo-Wurzelverzeichnis:  infra/db/grants-prod.sh
set -euo pipefail

exec "$(dirname "$0")/run-prod.sh" db:grants
