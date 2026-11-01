import {
  cardExpiresBefore,
  cardsToCheck,
  dunningCases,
  rememberCard,
  sendDunningNotice,
  type DunningCase,
} from "@idf/db/dunning";
import type pg from "pg";
import type Stripe from "stripe";

/**
 * Täglicher Lauf des Mahnwesens nach dem Einzug: Erinnerungen, Mahnungen und Hinweise auf ablaufende
 * Karten in den Postausgang legen. Gibt nur Zahlen zurück, keine Kundendaten.
 */

export interface DunningRun {
  erinnerung: number;
  fehlgeschlagen: number;
  ohne_zahlungsart: number;
  letzte_mahnung: number;
  karte_ablauf: number;
  cardsChecked: number;
  errors: number;
}

async function inTx<T>(pool: pg.Pool, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query(`select set_config('app.actor', 'system:mahnwesen', true)`);
    const r = await fn(c);
    await c.query("commit");
    return r;
  } catch (err) {
    await c.query("rollback").catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}

export async function runDunning(pool: pg.Pool, stripe: Stripe | null, today: string, baseUrl: string): Promise<DunningRun> {
  const run: DunningRun = { erinnerung: 0, fehlgeschlagen: 0, ohne_zahlungsart: 0, letzte_mahnung: 0, karte_ablauf: 0, cardsChecked: 0, errors: 0 };
  const cases: DunningCase[] = await dunningCases(pool, today);

  if (stripe) {
    for (const k of await cardsToCheck(pool, today)) {
      try {
        let card = k.cached;
        // Nur nachfragen, wenn unbekannt oder laut Speicher abgelaufen (die Bank kann die Karte verlängert haben).
        if (!card || cardExpiresBefore(card, k.dueDate)) {
          const pm = await stripe.paymentMethods.retrieve(k.ref);
          run.cardsChecked++;
          if (!pm.card) continue;
          card = { brand: pm.card.brand ?? null, last4: pm.card.last4 ?? null, expMonth: pm.card.exp_month, expYear: pm.card.exp_year };
          await rememberCard(pool, k.ref, card);
        }
        if (cardExpiresBefore(card, k.dueDate)) {
          cases.push({ kind: "karte_ablauf", key: `karte_ablauf:${k.ref}`, orderId: k.orderId, installmentId: k.installmentId, card });
        }
      } catch (err) {
        console.error(`Karte ${k.ref} nicht geprüft:`, (err as Error).message);
        run.errors++;
      }
    }
  }

  for (const c of cases) {
    try {
      if (await inTx(pool, (client) => sendDunningNotice(client, c, baseUrl))) run[c.kind]++;
    } catch (err) {
      console.error(`Mahnwesen ${c.kind} für Bestellung ${c.orderId} nicht verschickt:`, (err as Error).message);
      run.errors++;
    }
  }
  return run;
}
