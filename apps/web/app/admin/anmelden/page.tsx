import { LoginForm } from "./login-form";

export default async function LoginPage(props: { searchParams: Promise<{ abgelaufen?: string }> }) {
  const { abgelaufen } = await props.searchParams;
  return (
    <section className="card admin-login">
      <h1>Anmelden</h1>
      {abgelaufen && (
        <p className="error" role="alert">
          Der Link ist abgelaufen oder wurde schon benutzt. Fordere einfach einen neuen an.
        </p>
      )}
      <LoginForm />
    </section>
  );
}
