#!/usr/bin/env bash
# Generalprobe der Datensicherung (Abschluss-Kriterium Phase 0, im Kleinen):
#   1. PostgreSQL mit allen Migrationen und Testrechnungen aufsetzen
#   2. Vollsicherung an Backup A (SFTP) und Backup B (S3 mit Object Lock)
#   3. Weitere Rechnungen nach der Sicherung, nur über das WAL-Archiv gesichert
#   4. Primärserver wegwerfen, aus A und aus B getrennt wiederherstellen
#   5. Je Wiederherstellung prüfen: alle Rechnungen da, Nummern lückenlos,
#      Audit-Kette intakt und identisch mit dem Original
#   6. Object Lock: Löschen einer gesperrten Sicherungsdatei muss scheitern
#
# Läuft als normaler Nutzer (nicht root). Ziele kommen aus der Umgebung:
#   SFTP_HOST SFTP_PORT SFTP_USER SFTP_KEY SFTP_PATH
#   S3_ENDPOINT (nur Hostname) S3_PORT S3_BUCKET S3_REGION S3_KEY S3_SECRET
#   (S3 lokal optional, Pflicht mit PROBE_REQUIRE_S3=1)
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
repo_root=$(cd "$here/../../.." && pwd)

pg_bin=${PG_BIN:-$(printf "%s\n" /usr/lib/postgresql/*/bin | sort -V | tail -1)}
work=${PROBE_DIR:-$(mktemp -d)}
port_primary=5490
port_restore=5491
conf="$work/pgbackrest.conf"
stanza=probe

use_s3=0
if [[ -n "${S3_ENDPOINT:-}" ]]; then
  use_s3=1
elif [[ "${PROBE_REQUIRE_S3:-0}" == 1 ]]; then
  echo "S3_ENDPOINT fehlt, Backup B kann nicht geprüft werden" >&2
  exit 1
else
  echo "WARNUNG: kein S3-Ziel gesetzt, Backup B wird übersprungen (nur lokal zulässig)" >&2
fi
repos=(1)
if ((use_s3)); then repos+=(2); fi

log() { printf '\n== %s\n' "$*"; }

cleanup() {
  "$pg_bin/pg_ctl" -D "$work/primary" stop -m immediate >/dev/null 2>&1 || true
  "$pg_bin/pg_ctl" -D "$work/restore" stop -m immediate >/dev/null 2>&1 || true
  [[ -z "${PROBE_KEEP:-}" ]] && rm -rf "$work"
}
trap cleanup EXIT

mkdir -p "$work"/{log,lock,spool}

global_block() {
  cat <<EOF
[global]
log-path=$work/log
lock-path=$work/lock
spool-path=$work/spool
log-level-console=warn
log-level-file=detail
compress-type=zst
start-fast=y
EOF
}

repo1_block() {
  cat <<EOF
repo1-type=sftp
repo1-sftp-host=${SFTP_HOST:?SFTP_HOST fehlt}
repo1-sftp-host-port=${SFTP_PORT:-22}
repo1-sftp-host-user=${SFTP_USER:?SFTP_USER fehlt}
repo1-sftp-private-key-file=${SFTP_KEY:?SFTP_KEY fehlt}
repo1-sftp-host-key-check-type=none
repo1-sftp-host-key-hash-type=sha256
repo1-path=${SFTP_PATH:?SFTP_PATH fehlt}
repo1-cipher-type=aes-256-cbc
repo1-cipher-pass=probe-schluessel-a
repo1-retention-full=2
repo1-bundle=y
repo1-block=y
EOF
}

repo2_block() {
  cat <<EOF
repo2-type=s3
repo2-s3-endpoint=${S3_ENDPOINT}
repo2-storage-port=${S3_PORT:-443}
repo2-s3-bucket=${S3_BUCKET:?S3_BUCKET fehlt}
repo2-s3-region=${S3_REGION:-eu-central-1}
repo2-s3-key=${S3_KEY:?S3_KEY fehlt}
repo2-s3-key-secret=${S3_SECRET:?S3_SECRET fehlt}
repo2-s3-uri-style=path
repo2-storage-verify-tls=n
repo2-path=/pgbackrest
repo2-cipher-type=aes-256-cbc
repo2-cipher-pass=probe-schluessel-b
repo2-retention-full=2
repo2-bundle=y
repo2-block=y
EOF
}

stanza_block() {
  cat <<EOF
[$stanza]
pg1-path=$1
pg1-port=$2
pg1-socket-path=$work
EOF
}

# Betrieb: beide Ziele. Wiederherstellung: je Ziel eine eigene Konfiguration, die nur
# dieses Ziel kennt, damit auch das WAL garantiert nur aus diesem Ziel kommt.
{ global_block; repo1_block; if ((use_s3)); then repo2_block; fi; stanza_block "$work/primary" "$port_primary"; } >"$conf"
{ global_block; repo1_block; stanza_block "$work/restore" "$port_restore"; } >"$work/restore-1.conf"
if ((use_s3)); then
  { global_block; repo2_block; stanza_block "$work/restore" "$port_restore"; } >"$work/restore-2.conf"
fi

pgbr() { pgbackrest --config="$conf" --stanza="$stanza" "$@"; }
sql() { psql -X -q -h "$work" -p "$1" -d idf -v ON_ERROR_STOP=1 -tA -c "$2"; }

log "Primärserver aufsetzen ($("$pg_bin/postgres" --version))"
"$pg_bin/initdb" -D "$work/primary" -U "$(whoami)" --auth=trust -E UTF8 --locale=C.UTF-8 >/dev/null
cat >>"$work/primary/postgresql.conf" <<EOF
port = $port_primary
listen_addresses = ''
unix_socket_directories = '$work'
wal_level = replica
archive_mode = on
archive_command = 'pgbackrest --config=$conf --stanza=$stanza archive-push %p'
archive_timeout = 60
EOF
"$pg_bin/pg_ctl" -D "$work/primary" -l "$work/log/primary.log" -w start >/dev/null
createdb -h "$work" -p "$port_primary" idf

log "Migrationen einspielen"
(cd "$repo_root" && DATABASE_URL="postgresql://$(whoami)@localhost/idf?host=$work&port=$port_primary" pnpm -s db:migrate)

log "Testrechnungen vor der Sicherung"
psql -X -q -h "$work" -p "$port_primary" -d idf -v phase=vorher -f "$here/seed.sql" >/dev/null

log "Stanza anlegen und Vollsicherung an Backup ${repos[*]}"
pgbr stanza-create
for r in "${repos[@]}"; do
  pgbr --repo="$r" --type=full backup
done

log "Weitere Rechnungen nach der Sicherung (nur im WAL-Archiv)"
psql -X -q -h "$work" -p "$port_primary" -d idf -v phase=nachher -f "$here/seed.sql" >/dev/null
# Prüft, dass ein frisch geschlossenes WAL-Segment in allen Zielen ankommt.
pgbr check

expected_count=$(sql "$port_primary" "select count(*) from app.invoices")
expected_max=$(sql "$port_primary" "select max(number_seq) from app.invoices")
expected_head=$(sql "$port_primary" "select last_id || ':' || encode(last_hash, 'hex') from app.audit_head()")
echo "Original: $expected_count Rechnungen bis Nr. $expected_max, Audit-Kopf $expected_head"

log "Primärserver wegwerfen"
"$pg_bin/pg_ctl" -D "$work/primary" stop -m fast >/dev/null
rm -rf "$work/primary"

failed=0
for r in "${repos[@]}"; do
  log "Wiederherstellung aus Backup $r"
  rm -rf "$work/restore"
  pgbackrest --config="$work/restore-$r.conf" --stanza="$stanza" restore
  "$pg_bin/pg_ctl" -D "$work/restore" -l "$work/log/restore-$r.log" \
    -o "-p $port_restore -c archive_mode=off" -w start >/dev/null
  for _ in $(seq 1 60); do
    [[ $(sql "$port_restore" "select pg_is_in_recovery()") == f ]] && break
    sleep 1
  done

  count=$(sql "$port_restore" "select count(*) from app.invoices")
  max=$(sql "$port_restore" "select max(number_seq) from app.invoices")
  gaps=$(sql "$port_restore" "select count(*) from (select number_seq - lag(number_seq) over (partition by company_id order by number_seq) d from app.invoices) x where d <> 1")
  broken=$(sql "$port_restore" "select count(*) from app.audit_verify()")
  head=$(sql "$port_restore" "select last_id || ':' || encode(last_hash, 'hex') from app.audit_head()")
  echo "Backup $r: $count Rechnungen bis Nr. $max, Lücken $gaps, Kettenfehler $broken"

  [[ "$count" == "$expected_count" ]] || { echo "FEHLER: Anzahl Rechnungen weicht ab" >&2; failed=1; }
  [[ "$max" == "$expected_max" ]] || { echo "FEHLER: letzte Rechnungsnummer weicht ab" >&2; failed=1; }
  [[ "$gaps" == 0 ]] || { echo "FEHLER: Lücke im Nummernkreis" >&2; failed=1; }
  [[ "$broken" == 0 ]] || { echo "FEHLER: Audit-Kette beschädigt" >&2; failed=1; }
  [[ "$head" == "$expected_head" ]] || { echo "FEHLER: Audit-Kopf weicht vom Original ab" >&2; failed=1; }

  "$pg_bin/pg_ctl" -D "$work/restore" stop -m fast >/dev/null
done

if ((use_s3)); then
  log "Object Lock: gesperrte Sicherungsdatei löschen (muss scheitern)"
  aws_s3() {
    AWS_ACCESS_KEY_ID=$S3_KEY AWS_SECRET_ACCESS_KEY=$S3_SECRET AWS_DEFAULT_REGION=${S3_REGION:-eu-central-1} \
      aws --endpoint-url "https://$S3_ENDPOINT:${S3_PORT:-443}" --no-verify-ssl s3api "$@" 2>/dev/null
  }
  read -r key version < <(aws_s3 list-object-versions --bucket "$S3_BUCKET" --prefix pgbackrest/backup/ \
    --query 'Versions[0].[Key,VersionId]' --output text)
  if aws_s3 delete-object --bucket "$S3_BUCKET" --key "$key" --version-id "$version" >/dev/null; then
    echo "FEHLER: $key ließ sich trotz Object Lock löschen" >&2
    failed=1
  else
    echo "Löschen von $key wurde wie erwartet verweigert"
  fi
fi

if ((failed)); then
  log "GENERALPROBE FEHLGESCHLAGEN"
  exit 1
fi
log "Generalprobe bestanden: Wiederherstellung aus Backup ${repos[*]} vollständig und unverändert"
