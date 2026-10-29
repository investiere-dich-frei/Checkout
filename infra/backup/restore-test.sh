#!/usr/bin/env bash
# Monatlicher Wiederherstellungstest auf einem frischen Wegwerf-Server oder lokal.
# Ungerade Monate aus Backup A, gerade Monate aus Backup B. Erfolg oder Fehler geht an das Monitoring.
#
#   idf-restore-test            # Ziel nach Monat
#   idf-restore-test --repo=2   # Ziel erzwingen
set -euo pipefail

month=$(date +%-m)
repo=$(( month % 2 == 1 ? 1 : 2 ))
for arg in "$@"; do
  case "$arg" in --repo=*) repo="${arg#--repo=}" ;; esac
done

target=/var/lib/idf-restore-test
port=5499
pg_bin=/usr/lib/postgresql/17/bin

cleanup() {
  sudo -u postgres "$pg_bin/pg_ctl" -D "$target" stop -m fast >/dev/null 2>&1 || true
  rm -rf "$target"
}
trap cleanup EXIT

rm -rf "$target" && install -d -o postgres -m 700 "$target"
sudo -u postgres pgbackrest --stanza=idf --repo="$repo" --pg1-path="$target" \
  restore
sudo -u postgres "$pg_bin/pg_ctl" -D "$target" -o "-p $port -c archive_mode=off" -w start

psql_q() { sudo -u postgres psql -p "$port" -d idf -tAc "$1"; }

# Prüfungen: Audit-Kette intakt, Rechnungsnummern ohne Lücke, Daten aktuell.
broken=$(psql_q "select count(*) from app.audit_verify()")
gaps=$(psql_q "select count(*) from (select number_seq - lag(number_seq) over (partition by company_id order by number_seq) d from app.invoices) x where d > 1")
age_h=$(psql_q "select coalesce(extract(epoch from now() - max(occurred_at)) / 3600, 0)::int from app.audit_log")

echo "Backup ${repo}: Audit-Kette Fehler=${broken}, Nummernlücken=${gaps}, letzter Eintrag vor ${age_h} h"
if [[ "$broken" != 0 || "$gaps" != 0 || "$age_h" -gt 48 ]]; then
  echo "WIEDERHERSTELLUNGSTEST FEHLGESCHLAGEN" >&2
  exit 1
fi
# Erfolg an Uptime Kuma melden (Push-Monitor), Adresse aus /etc/idf/restore-test.env
if [[ -f /etc/idf/restore-test.env ]]; then
  # shellcheck disable=SC1091
  source /etc/idf/restore-test.env
  curl -fsS "${KUMA_PUSH_URL}?status=up&msg=repo${repo}" >/dev/null
fi
