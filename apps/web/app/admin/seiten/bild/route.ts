import { canChange } from "@idf/db/admin";
import { sessionUser } from "@idf/db/auth";
import { MAX_IMAGE_BYTES, PageContentError, saveImage } from "@idf/db/checkout-pages";
import { cookies } from "next/headers";
import { pool, transaction } from "../../../../lib/db";
import { SESSION_COOKIE } from "../../../../lib/session";

/** Bild für eine Kaufseite hochladen (nur Admins). Antwort: { id, name } oder { error }. */
export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin && origin !== process.env.PUBLIC_BASE_URL?.replace(/\/$/, "")) {
    return Response.json({ error: "Nicht erlaubt" }, { status: 403 });
  }
  const jar = await cookies();
  const user = await sessionUser(pool(), jar.get(SESSION_COOKIE)?.value);
  if (!user || !canChange(user)) return Response.json({ error: "Nur Admins dürfen Bilder hochladen." }, { status: 403 });

  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_IMAGE_BYTES + 64 * 1024) return Response.json({ error: "Das Bild ist größer als 3 MB" }, { status: 413 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") return Response.json({ error: "Keine Datei gewählt" }, { status: 400 });
  try {
    const data = new Uint8Array(await file.arrayBuffer());
    const id = await transaction(`user:${user.id}`, (c) => saveImage(c, data, file.name, user.id));
    return Response.json({ id, name: file.name });
  } catch (err) {
    if (err instanceof PageContentError) return Response.json({ error: err.message }, { status: 400 });
    console.error("Bild nicht gespeichert", (err as Error).message);
    return Response.json({ error: "Hochladen fehlgeschlagen" }, { status: 500 });
  }
}
