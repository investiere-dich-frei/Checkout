# Hinweise für die Arbeit in diesem Repository

- Sprache: Doku, Commit-Texte, Fehlermeldungen und Kommentare auf Deutsch; Bezeichner im Code auf Englisch.
- Jede Änderung kommt als Pull Request; Christian (`investiere-dich-frei`) gibt frei.
- Migrationen in `packages/db/migrations` werden nach dem Einspielen nie geändert, nur durch neue ergänzt. Der Runner bricht bei abweichender Prüfsumme ab.
- GoBD-Regeln (Unveränderbarkeit, Nummernkreis, Audit-Log) nie abschwächen, ohne dass Christian das ausdrücklich freigibt.
- Tests laufen gegen ein echtes PostgreSQL:
  `docker compose up -d postgres && DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres pnpm test`
- Keine echten Kundendaten in Tests, Fixtures oder Logs.
