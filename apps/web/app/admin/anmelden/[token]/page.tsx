import { redeemLoginAction } from "../../actions";

// Ein Klick ist nötig: Mailprogramme rufen Links oft vorab auf und würden ihn sonst verbrauchen.
export default async function RedeemPage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  return (
    <section className="card">
      <h1>Anmelden</h1>
      <form action={redeemLoginAction}>
        <input type="hidden" name="token" value={token} />
        <button className="order" type="submit">
          Jetzt anmelden
        </button>
      </form>
    </section>
  );
}
