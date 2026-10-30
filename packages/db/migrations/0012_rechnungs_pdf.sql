-- 0012 Rechnungs-PDF, unveränderbar in der Datenbank abgelegt.
--
-- Das PDF entsteht in derselben Transaktion wie die Rechnung und ist genau das
-- Dokument, das die Kundin per E-Mail bekommt. Die Rechnung verweist über
-- pdf_sha256 und pdf_storage_key („db:<id>“) darauf. Liegt später ein WORM-Speicher
-- bereit, wird das PDF dorthin kopiert; der Hash bleibt der Nachweis.

create table app.invoice_documents (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null unique references app.invoices (id),
  pdf         bytea not null,
  sha256      bytea not null,
  created_at  timestamptz not null default now(),
  check (sha256 = sha256(pdf))
);

create trigger invoice_documents_immutable
  before update or delete on app.invoice_documents
  for each row execute function app.forbid_change();
create trigger invoice_documents_no_truncate
  before truncate on app.invoice_documents
  for each statement execute function app.forbid_change();

-- Kein eigener Audit-Eintrag mit den PDF-Bytes: Das Setzen von pdf_sha256 an der
-- Rechnung steht im Audit-Log und belegt, welches Dokument dazugehört.
