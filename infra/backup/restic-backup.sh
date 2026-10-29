#!/usr/bin/env bash
# Sichert Dateien an beide Ziele. Zugangsdaten liegen in /etc/idf/restic-{a,b}.env (aus SOPS).
set -euo pipefail

PATHS=(/etc/idf /etc/pgbackrest /var/lib/idf/uploads)

for target in a b; do
  # shellcheck disable=SC1090
  set -a; source "/etc/idf/restic-${target}.env"; set +a
  restic backup --tag idf --one-file-system "${PATHS[@]}"
  restic forget --tag idf --keep-daily 14 --keep-weekly 8 --keep-monthly 24 --prune
  restic check --read-data-subset=5%
done
