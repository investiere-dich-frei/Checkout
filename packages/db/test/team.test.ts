import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { redeemLogin, sessionUser, type SessionUser } from "../src/auth.ts";
import { createTeamMember, listTeam, TeamError, updateTeamMember } from "../src/team.ts";
import { createTestDb, tx, type TestDb } from "./helpers.ts";

// Ausgedachte Personen, keine echten Daten.
describe("Team-Verwaltung", () => {
  let db: TestDb;
  let admin: SessionUser;

  before(async () => {
    db = await createTestDb();
    const id = (await db.pool.query(`insert into app.users (email, display_name, role) values ('chef@example.org', 'Chef', 'admin') returning id`)).rows[0].id;
    admin = { id, email: "chef@example.org", displayName: "Chef", role: "admin", salesCode: null };
  });
  after(() => db.drop());

  const lastLoginToken = async (email: string) => {
    const body = (await db.pool.query(`select body_text from app.mail_outbox where purpose = 'anmeldung' and to_address = $1 order by created_at desc limit 1`, [email])).rows[0].body_text as string;
    return /\/admin\/anmelden\/([A-Za-z0-9_-]+)/.exec(body)![1]!;
  };

  it("legt Personen an, schickt den Anmeldelink und prüft die Eingaben", async () => {
    const id = await tx(db.pool, (c) =>
      createTeamMember(c, admin, { email: " Vera@Example.org ", displayName: "Vera", role: "vertrieb", salesCode: "Vera" }, "https://kasse.example.org"),
    );
    const s = await tx(db.pool, async (c) => redeemLogin(c, await lastLoginToken("vera@example.org")));
    assert.ok(s);
    const vera = (await sessionUser(db.pool, s.session))!;
    assert.deepEqual([vera.id, vera.role, vera.salesCode], [id, "vertrieb", "vera"]);

    await assert.rejects(tx(db.pool, (c) => createTeamMember(c, admin, { email: "vera@example.org", displayName: "V", role: "pruefer", salesCode: "" }, null)), /schon Zugang/);
    await assert.rejects(tx(db.pool, (c) => createTeamMember(c, admin, { email: "x@example.org", displayName: "X", role: "vertrieb", salesCode: "" }, null)), /Kürzel/);
    await assert.rejects(tx(db.pool, (c) => createTeamMember(c, admin, { email: "y@example.org", displayName: "Y", role: "freelancer", salesCode: "vera" }, null)), /vergeben/);
    await assert.rejects(tx(db.pool, (c) => createTeamMember(c, admin, { email: "z@example.org", displayName: "Z", role: "chef", salesCode: "" }, null)), TeamError);
    await assert.rejects(tx(db.pool, (c) => createTeamMember(c, vera, { email: "w@example.org", displayName: "W", role: "admin", salesCode: "" }, null)), /Berechtigung/);
    await assert.rejects(listTeam(db.pool, vera), /Berechtigung/);
    assert.equal((await listTeam(db.pool, admin)).length, 2);

    // Sperren beendet die Sitzung sofort, und es gibt keinen neuen Anmeldelink.
    assert.equal(await tx(db.pool, (c) => updateTeamMember(c, admin, id, { displayName: "Vera", role: "vertrieb", salesCode: "vera", active: false })), true);
    assert.equal(await sessionUser(db.pool, s.session), null);
    const before = (await db.pool.query(`select count(*)::int n from app.mail_outbox where purpose = 'anmeldung'`)).rows[0].n;
    const { requestLogin } = await import("../src/auth.ts");
    assert.equal(await tx(db.pool, (c) => requestLogin(c, "vera@example.org", "https://x")), false);
    assert.equal((await db.pool.query(`select count(*)::int n from app.mail_outbox where purpose = 'anmeldung'`)).rows[0].n, before);
    assert.equal(await tx(db.pool, (c) => updateTeamMember(c, admin, id, { displayName: "Vera", role: "vertrieb", salesCode: "vera", active: false })), false);
  });

  it("lässt immer mindestens einen Admin übrig und schützt den eigenen Zugang", async () => {
    await assert.rejects(tx(db.pool, (c) => updateTeamMember(c, admin, admin.id, { displayName: "Chef", role: "pruefer", salesCode: "", active: true })), /eigene/);
    const second = await tx(db.pool, (c) => createTeamMember(c, admin, { email: "zweite@example.org", displayName: "Zweite", role: "admin", salesCode: "" }, null));
    const zweite: SessionUser = { id: second, email: "zweite@example.org", displayName: "Zweite", role: "admin", salesCode: null };
    // Die zweite Admin darf den ersten zur Prüfung machen, danach aber sich selbst nicht mehr herabstufen.
    assert.equal(await tx(db.pool, (c) => updateTeamMember(c, zweite, admin.id, { displayName: "Chef", role: "pruefer", salesCode: "", active: true })), true);
    await assert.rejects(tx(db.pool, (c) => updateTeamMember(c, zweite, second, { displayName: "Zweite", role: "admin", salesCode: "", active: false })), /eigene/);
    const audit = (await db.pool.query(`select count(*)::int n from app.audit_log where table_name = 'users' and action = 'UPDATE'`)).rows[0].n;
    assert.ok(audit >= 1);
    assert.deepEqual((await db.pool.query(`select * from app.audit_verify()`)).rows, []);
  });
});
