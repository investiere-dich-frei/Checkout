#!/usr/bin/env bash
# Schreibt Kennzahlen zu pgBackRest für den Node-Exporter (Textfile-Collector).
# Läuft per Cron auf db-nbg1. Prometheus alarmiert, wenn die letzte Sicherung zu alt ist.
set -euo pipefail

out=/var/lib/prometheus/node-exporter/pgbackrest.prom
tmp=$(mktemp "${out}.XXXX")
trap 'rm -f "$tmp"' EXIT

if info=$(sudo -u postgres pgbackrest --stanza=idf --output=json info 2>/dev/null); then
  ok=1
else
  ok=0
  info='[]'
fi

{
  echo "# HELP idf_pgbackrest_info_ok 1, wenn pgbackrest info lief"
  echo "# TYPE idf_pgbackrest_info_ok gauge"
  echo "idf_pgbackrest_info_ok ${ok}"
  echo "# HELP idf_pgbackrest_last_backup_timestamp Ende der letzten Sicherung je Ziel (Unix-Zeit)"
  echo "# TYPE idf_pgbackrest_last_backup_timestamp gauge"
  jq -r '.[0].backup // [] | group_by(.database.["repo-key"]) | .[] |
    "idf_pgbackrest_last_backup_timestamp{repo=\"\(.[-1].database.["repo-key"])\"} \(.[-1].timestamp.stop)"' <<<"$info"
} >"$tmp"

chmod 0644 "$tmp"
mv "$tmp" "$out"
trap - EXIT
