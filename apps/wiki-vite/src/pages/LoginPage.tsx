import type { FormEvent, KeyboardEvent } from "react";
import { useMemo, useState } from "react";

export function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const redirect = useMemo(() => {
    const value = new URL(window.location.href).searchParams.get("redirect");
    return value && value.startsWith("/") ? value : "/";
  }, []);

  function handlePasswordKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;

    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });

    if (response.ok) {
      window.location.assign(redirect);
      return;
    }

    setError("Incorrect password");
    setPassword("");
  }

  return (
    <div className="auth-page" data-test-id="login-page">
      <form onSubmit={onSubmit} className="auth-card">
        <h1 className="auth-title">TNBC Knowledge Base</h1>
        <input
          type="password"
          aria-label="Password"
          placeholder="Password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          onKeyDown={handlePasswordKeyDown}
          className="auth-input"
          enterKeyHint="go"
        />
        {error ? <p className="auth-error">{error}</p> : null}
        <button type="submit" className="auth-button">
          Enter
        </button>
      </form>
    </div>
  );
}
