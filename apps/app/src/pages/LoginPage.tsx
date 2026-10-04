import type { FormEvent, KeyboardEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { LANDING_TITLE } from "../special-route-metadata";
import { LockKeyhole } from "lucide-react";
import { LandingPage } from "./LandingPage";
import {
  SIGN_IN_DESTINATION_EVENT,
  signInRedirectTarget,
} from "./landing-sign-in";

export function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [destination, setDestination] = useState("");
  const initial = useMemo(() => {
    const url = new URL(window.location.href);
    return { redirect: url.searchParams.get("redirect"), hash: url.hash };
  }, []);

  useEffect(() => {
    document.title = LANDING_TITLE;
  }, []);

  useEffect(() => {
    function onDestination(event: Event) {
      setDestination((event as CustomEvent<{ label: string }>).detail.label);
    }
    window.addEventListener(SIGN_IN_DESTINATION_EVENT, onDestination);
    return () =>
      window.removeEventListener(SIGN_IN_DESTINATION_EVENT, onDestination);
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
        window.location.assign(signInRedirectTarget(initial));
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
        <p className="auth-destination" aria-live="polite">
          {destination && `Sign in to open ${destination}.`}
        </p>
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
          <LockKeyhole size={13} /> A private space for Diana’s village.
        </p>
      </form>
    </LandingPage>
  );
}
