import type { FormEvent, KeyboardEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, LockKeyhole } from "lucide-react";
import { PublicThemeControl } from "../PublicThemeControl";
import { SIGN_IN_TITLE } from "../special-route-metadata";
import { DianaBrand, VillageTexture } from "./LandingBrands";
import { ThemedImage } from "./LandingShowcase";
import { asksForSignIn, signInRedirectTarget } from "./sign-in";
import "./landing.css";

function PasswordForm() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const redirect = useMemo(() => signInRedirectTarget(window.location), []);

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
    <form onSubmit={onSubmit} className="auth-card">
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
  );
}

export function SignInPage() {
  const continuing = useMemo(() => asksForSignIn(window.location.search), []);

  useEffect(() => {
    document.title = SIGN_IN_TITLE;
  }, []);

  return (
    <div className="landing-page sign-in-page" data-test-id="sign-in-page">
      <section className="si-art" aria-label="Diana TNBC">
        <VillageTexture />
        <a className="lp-brand" href="/" aria-label="Diana TNBC home">
          <DianaBrand />
        </a>
        <figure className="si-cartoon">
          <ThemedImage
            base="/landing/sign-in-cartoon"
            extension="webp"
            width="900"
            height="900"
            fetchPriority="high"
            alt="Cartoon of a purple immune cell reading a notebook while smaller cells search, take notes, and share reports around it"
          />
        </figure>
        <div className="si-art-copy">
          <p className="si-motto">
            It takes <span>a village.</span>
          </p>
          <p>
            Diana’s records, research, and the people helping her, together.
          </p>
        </div>
      </section>
      <main className="si-panel">
        <div className="si-theme">
          <PublicThemeControl />
        </div>
        <div className="si-form">
          <h1 id="sign-in-title">Open Diana’s knowledge base.</h1>
          <p>
            {continuing
              ? "Enter the shared password to continue to the page you opened."
              : "Enter the shared password to continue."}
          </p>
          <PasswordForm />
          <p className="si-access">Need access? Ask Jason.</p>
        </div>
        <nav className="si-links" aria-label="More from Diana TNBC">
          <a href="/">
            <ArrowLeft size={15} /> About the knowledge base
          </a>
          <a href="/education">
            Browse educational content <ArrowRight size={15} />
          </a>
        </nav>
      </main>
    </div>
  );
}
