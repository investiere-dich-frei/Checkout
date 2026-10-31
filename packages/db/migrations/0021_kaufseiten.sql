-- 0021 Gestaltung der Kaufseiten, wie im Thrivecart-Editor.
--
-- Jede Kaufseite besteht aus einem Kopfbereich (Logo, Überschrift, Bild, Knopf) und
-- Bausteinen (Text, Aufzählung, Bild, Zitat, Person, Vertrauenshinweise). Die Inhalte
-- liegen als jsonb in app.checkout_pages; die Anwendung prüft ihren Aufbau
-- (packages/db/src/checkout-pages.ts). Eine Zeile ohne Produkt ist die Standardseite:
-- Sie gilt für alle Produkte ohne eigene Seite und liefert Logo und Farbe als Vorgabe.
--
-- Preise, Bestellknopf und Rechtstexte gehören nicht dazu: Sie kommen immer aus dem
-- System und lassen sich im Editor nicht ändern.
--
-- Bilder liegen in der Datenbank (app.checkout_images), damit sie mit gesichert werden
-- und nicht mehr von Thrivecart abhängen. Gleiche Dateien werden nur einmal gespeichert.

create table app.checkout_pages (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid unique references app.products (id),
  content     jsonb not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references app.users (id)
);

-- Höchstens eine Standardseite.
create unique index checkout_pages_one_default on app.checkout_pages ((product_id is null)) where product_id is null;

create trigger checkout_pages_audit
  after insert or update or delete on app.checkout_pages
  for each row execute function app.audit_row();

-- Ohne Audit-Trigger: Das Log würde jede Bilddatei als Text kopieren. Bilder werden
-- nie geändert; welche Seite welches Bild zeigt, steht im Audit-Log der Seiten.
create table app.checkout_images (
  id            uuid primary key default gen_random_uuid(),
  sha256        bytea not null unique,
  mime_type     text not null check (mime_type in ('image/png', 'image/jpeg', 'image/webp', 'image/gif')),
  data          bytea not null check (octet_length(data) between 1 and 3145728),
  original_name text not null,
  created_at    timestamptz not null default now(),
  created_by    uuid references app.users (id)
);

create or replace function app.checkout_images_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'Bilder der Kaufseiten werden nicht geändert; neue Datei hochladen';
end;
$$;

create trigger checkout_images_no_update
  before update on app.checkout_images
  for each row execute function app.checkout_images_immutable();
