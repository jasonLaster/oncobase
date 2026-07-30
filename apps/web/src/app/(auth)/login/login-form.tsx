"use client";

import type { KeyboardEvent } from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { safeLoginRedirect } from "@/lib/safe-redirect";

function handlePasswordKeyDown(e: KeyboardEvent<HTMLInputElement>) {
  if (e.key !== "Enter" || e.nativeEvent.isComposing) {
    return;
  }

  e.preventDefault();
  e.currentTarget.form?.requestSubmit();
}

export function LoginForm() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });

    if (res.ok) {
      const searchParams = new URLSearchParams(window.location.search);
      const destination = safeLoginRedirect(
        searchParams.get("redirect"),
        window.location.hash,
      );
      router.push(destination);
      router.refresh();
    } else {
      setError("Incorrect password");
      setPassword("");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="auth-card">
      <h1 className="auth-title">TNBC Knowledge Base</h1>
      <input
        type="password"
        aria-label="Password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={handlePasswordKeyDown}
        className="auth-input"
        enterKeyHint="go"
      />
      {error && <p className="auth-error">{error}</p>}
      <button type="submit" className="auth-button">
        Enter
      </button>
    </form>
  );
}
