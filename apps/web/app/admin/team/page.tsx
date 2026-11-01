import { listTeam, ROLES } from "@idf/db/team";
import { redirect } from "next/navigation";
import { pool } from "../../../lib/db";
import { requireUser } from "../../../lib/session";
import { ActionForm } from "../produkte/forms";
import { createTeamMemberAction, updateTeamMemberAction } from "./actions";

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin (alles)",
  vertrieb: "Vertrieb (eigene Bestellungen, Kauflinks)",
  freelancer: "Freelancer (wie Vertrieb)",
  pruefer: "Prüfung (alles sehen, nichts ändern, z. B. Steuerberatung)",
};
const dateTime = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", dateStyle: "medium", timeStyle: "short" });

function RoleSelect(props: { id: string; value?: string }) {
  return (
    <select id={props.id} name="role" defaultValue={props.value ?? "vertrieb"}>
      {ROLES.map((r) => (
        <option key={r} value={r}>
          {ROLE_LABELS[r]}
        </option>
      ))}
    </select>
  );
}

export default async function TeamPage() {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/admin");
  const team = await listTeam(pool(), user);
  return (
    <>
      <section className="card">
        <h1>Team</h1>
        <p className="note">
          Wer hier steht, kann sich mit seiner E-Mail-Adresse per Anmeldelink anmelden. Sperren beendet die Anmeldung sofort.
          Das Kürzel steht in den Kauflinks (…?v=kürzel) und ordnet Verkäufe der Person zu. Alle Änderungen stehen im Audit-Log.
        </p>
        {team.map((m) => (
          <details key={m.id} className="team-member">
            <summary>
              <strong>{m.displayName}</strong> · {m.email} · {ROLE_LABELS[m.role]?.split(" (")[0] ?? m.role}
              {m.salesCode && <> · Kürzel {m.salesCode}</>}
              {!m.active && <> · <em>gesperrt</em></>}
              {m.lastLogin && <span className="note"> · zuletzt angemeldet {dateTime.format(m.lastLogin)}</span>}
            </summary>
            <ActionForm action={updateTeamMemberAction} submit="Speichern">
              <input type="hidden" name="user_id" value={m.id} />
              <div className="field">
                <label htmlFor={`name-${m.id}`}>Name</label>
                <input id={`name-${m.id}`} name="display_name" defaultValue={m.displayName} required />
              </div>
              <div className="field">
                <label htmlFor={`role-${m.id}`}>Rolle</label>
                <RoleSelect id={`role-${m.id}`} value={m.role} />
              </div>
              <div className="field">
                <label htmlFor={`code-${m.id}`}>Kürzel für Kauflinks</label>
                <input id={`code-${m.id}`} name="sales_code" defaultValue={m.salesCode ?? ""} pattern="[a-z0-9-]{2,32}" />
              </div>
              <div className="field check">
                <input id={`active-${m.id}`} type="checkbox" name="active" defaultChecked={m.active} disabled={m.id === user.id} />
                <label htmlFor={`active-${m.id}`}>Zugang aktiv</label>
              </div>
              {m.id === user.id && <input type="hidden" name="active" value="on" />}
            </ActionForm>
          </details>
        ))}
      </section>
      <section className="card">
        <h2>Person hinzufügen</h2>
        <ActionForm action={createTeamMemberAction} submit="Anlegen und Anmeldelink schicken">
          <div className="field">
            <label htmlFor="new-email">E-Mail-Adresse</label>
            <input id="new-email" name="email" type="email" required />
          </div>
          <div className="field">
            <label htmlFor="new-name">Name</label>
            <input id="new-name" name="display_name" required />
          </div>
          <div className="field">
            <label htmlFor="new-role">Rolle</label>
            <RoleSelect id="new-role" />
          </div>
          <div className="field">
            <label htmlFor="new-code">Kürzel für Kauflinks (bei Vertrieb und Freelancer Pflicht)</label>
            <input id="new-code" name="sales_code" pattern="[a-z0-9-]{2,32}" placeholder="z. B. vera" />
          </div>
        </ActionForm>
      </section>
    </>
  );
}
