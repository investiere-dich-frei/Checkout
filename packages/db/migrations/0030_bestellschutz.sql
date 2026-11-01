-- 0030 Schutz der Kaufseiten gegen Kartentests und Massenbestellungen.
--
-- Zähler je Stunde für Bestellungen je IP-Adresse und je E-Mail-Adresse, Gutscheinprüfungen
-- je IP-Adresse und verbrauchte Rechenaufgaben (Proof of Work, jede gilt nur einmal).
-- Gespeichert werden nur HMAC-Werte, nie die IP- oder E-Mail-Adresse selbst.

create table app.request_counters (
  scope        text not null check (scope in ('bestellung_ip', 'bestellung_email', 'gutschein_ip', 'rechenaufgabe')),
  key_hash     bytea not null,
  window_start timestamptz not null,
  hits         integer not null default 0 check (hits >= 0),
  primary key (scope, key_hash, window_start)
);
create index request_counters_window_idx on app.request_counters (window_start);
