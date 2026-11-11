-- 0033 Stornos festhalten: Wer hat eine Bestellung wann, warum und mit oder ohne Rückzahlung beendet.
--
-- ohne_rueckzahlung: offene Raten entfallen bzw. das Abo endet (sofort oder zum Datum), bereits
--                    Bezahltes bleibt bezahlt.
-- mit_rueckzahlung:  wie oben, zusätzlich werden die gewählten Rechnungen erstattet
--                    (Stornorechnung je Rechnung, siehe app.refunds).
-- Einträge sind festgeschrieben und werden nie geändert oder gelöscht.

create table app.order_cancellations (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references app.orders (id),
  kind          text not null check (kind in ('ohne_rueckzahlung', 'mit_rueckzahlung')),
  -- Letzter Tag der Laufzeit (Abo) bzw. Tag des Stornos.
  effective_on  date not null,
  reason        text not null check (length(trim(reason)) > 0),
  created_by    text not null,
  created_at    timestamptz not null default now()
);
create index order_cancellations_order_idx on app.order_cancellations (order_id, created_at);

create trigger order_cancellations_immutable
  before update or delete on app.order_cancellations
  for each row execute function app.forbid_change();
create trigger order_cancellations_no_truncate
  before truncate on app.order_cancellations
  for each statement execute function app.forbid_change();
create trigger order_cancellations_audit
  after insert or update or delete on app.order_cancellations
  for each row execute function app.audit_row();
