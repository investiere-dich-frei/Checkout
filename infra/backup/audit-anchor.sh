#!/usr/bin/env bash
# Schreibt den Kopf der Audit-Kette (letzte ID und Hash) in den WORM-Bucket.
# Damit fällt auf, falls jemand die jüngsten Protokollzeilen abschneidet.
set -euo pipefail
# shellcheck disable=SC1091
source /etc/idf/worm.env   # S3-Zugang zum Bucket mit Object Lock

day=$(date -u +%F)
head=$(psql -d idf -tAc "select last_id || ' ' || encode(last_hash, 'hex') from app.audit_head()")
printf '%s %s\n' "$day" "$head" | aws s3 cp - "s3://${WORM_BUCKET}/audit-anchor/${day}.txt" \
  --endpoint-url "$WORM_ENDPOINT"
