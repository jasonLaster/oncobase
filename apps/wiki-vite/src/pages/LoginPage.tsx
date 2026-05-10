import { FormEvent, useMemo, useState } from "react";

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
      <section className="login-panel">
        <p className="eyebrow">Private wiki</p>
        <h1>Sign in</h1>
        <form onSubmit={onSubmit}>
          <label>
            <span>Password</span>
            <input
              autoComplete="current-password"
              autoFocus
              name="password"
              onChange={(event) => setPassword(event.currentTarget.value)}
              type="password"
              value={password}
            />
          </label>
          {error ? <p className="auth-error">{error}</p> : null}
          <button disabled={submitting || !password} type="submit">
            {submitting ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </section>
    </article>
  );
}
