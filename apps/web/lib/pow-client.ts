/**
 * Lösung der Rechenaufgabe im Browser (Gegenstück zu lib/pow.ts). Rechnet in kleinen Häppchen,
 * damit die Seite bedienbar bleibt. Gibt null zurück, wenn abgebrochen oder WebCrypto fehlt.
 */
export async function solveInBrowser(challenge: string, bits: number, signal: { cancelled: boolean }): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  const enc = new TextEncoder();
  for (let i = 0; ; i++) {
    if (signal.cancelled) return null;
    const hash = new Uint8Array(await subtle.digest("SHA-256", enc.encode(`${challenge}:${i}`)));
    if (zeroBits(hash) >= bits) return String(i);
    if (i % 2000 === 1999) await new Promise((r) => setTimeout(r, 0));
  }
}

function zeroBits(hash: Uint8Array): number {
  let n = 0;
  for (const b of hash) {
    if (b === 0) {
      n += 8;
      continue;
    }
    return n + Math.clz32(b) - 24;
  }
  return n;
}
