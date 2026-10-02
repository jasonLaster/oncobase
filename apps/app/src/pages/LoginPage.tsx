import type { FormEvent, KeyboardEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { WIKI_SITE_NAME } from "../document-title";
import { safeLocalRedirect } from "../safe-redirect";
import { LockKeyhole } from "lucide-react";
import { LandingPage } from "./LandingPage";

export function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const redirect = useMemo(() => {
    const value = new URL(window.location.href).searchParams.get("redirect");
    const target = safeLocalRedirect(value, "");
    if (!target) return "/";

    const hash = window.location.hash;
    return hash && !target.includes("#") ? `${target}${hash}` : target;
  }, []);

  useEffect(() => {
    document.title = WIKI_SITE_NAME;
  }, []);

  function handlePasswordKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;

    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setError("");
    setSubmitting(true);
    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (response.ok) {
        window.location.assign(redirect);
        return;
      }
      setError(
        response.status === 401
          ? "Incorrect password"
          : "Sign in is temporarily unavailable. Please try again.",
      );
      setPassword("");
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <LandingPage>
      <form onSubmit={onSubmit} className="auth-card">
        <h3 className="auth-title">Diana TNBC Knowledge Base</h3>
        <input
          type="password"
          aria-label="Password"
          placeholder="Password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          onKeyDown={handlePasswordKeyDown}
          className="auth-input"
          enterKeyHint="go"
          autoComplete="current-password"
          required
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "login-error" : undefined}
        />
        {error ? (
          <p className="auth-error" id="login-error" role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" className="auth-button" disabled={submitting}>
          {submitting
            ? "Opening Diana’s knowledge base…"
            : "Enter Diana’s knowledge base"}
        </button>
        <p className="lp-access-note">
          <LockKeyhole size={11} /> A private space for your care village.
        </p>
      </form>
    </LandingPage>
  );
}
