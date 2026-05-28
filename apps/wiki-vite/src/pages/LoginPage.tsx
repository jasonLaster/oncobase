import { ArrowLeftIcon } from "lucide-react";
import { FormEvent, useMemo, useState } from "react";

const descriptionId = "login-description";

export function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const redirect = useMemo(() => {
    const value = new URL(window.location.href).searchParams.get("redirect");
    return value && value.startsWith("/") ? value : "/";
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });

    if (response.ok) {
      window.location.assign(redirect);
      return;
    }

    const body = await response.json().catch(() => ({ error: "Sign in failed" }));
    setError(typeof body.error === "string" ? body.error : "Sign in failed");
    setSubmitting(false);
  }

  return (
    <article className="login-shell" data-test-id="login-page">
      <section className="login-panel" aria-describedby={descriptionId}>
        <p className="eyebrow">Private wiki</p>
        <h1>Sign in to continue</h1>
        <p className="login-return" id={descriptionId}>
          This route is protected. After sign in, you will return to{" "}
          <code>{redirect}</code>.
        </p>
        <form onSubmit={onSubmit}>
          <label>
            <span>Password</span>
            <input
              aria-invalid={error ? "true" : undefined}
              autoComplete="current-password"
              autoFocus
              name="password"
              onChange={(event) => setPassword(event.currentTarget.value)}
              type="password"
              value={password}
            />
          </label>
          {error ? (
            <p className="auth-error" role="alert">
              {error}
            </p>
          ) : null}
          <button disabled={submitting || !password} type="submit">
            {submitting ? "Signing in..." : "Sign in"}
          </button>
        </form>
        <a className="login-back-link" href={redirect}>
          <ArrowLeftIcon size={15} aria-hidden="true" />
          Back to reader
        </a>
      </section>
    </article>
  );
}
