-- Rechte der Anwendungsrolle idf_app. Wird nach jeder Migration als idf_migrator
-- ausgeführt (pnpm db:grants) und ist wiederholbar.
--
-- Grundsatz (ADR 0001): Die Anwendung ist nie Eigentümerin der Tabellen und darf
-- nichts löschen. Was unveränderbar ist, schützen zusätzlich die Trigger.
-- Das Audit-Log schreiben nur die Trigger (security definer), die Anwendung liest es.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'idf_app') then
    raise exception 'Rolle idf_app fehlt; sie wird von Ansible angelegt';
  end if;
end;
$$;

do $$ begin execute format('grant connect on database %I to idf_app', current_database()); end; $$;
grant usage on schema app, legacy to idf_app;

revoke all on all tables in schema app from idf_app;
grant select, insert, update on all tables in schema app to idf_app;
revoke insert, update on app.audit_log from idf_app;
grant usage, select on all sequences in schema app to idf_app;

-- Altdaten aus Thrivecart: nur lesen. Der Import läuft als idf_migrator.
revoke all on all tables in schema legacy from idf_app;
grant select on all tables in schema legacy to idf_app;

grant execute on all functions in schema app to idf_app;
