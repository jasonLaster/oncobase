"use client";

import { type ReactElement, useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Command, Download, EllipsisVertical, FileText, LogIn, LogOut, Moon, Sparkles, Sun, UserPlus } from "lucide-react";
import { themeEffect } from "@/lib/theme-effect";
import { openActionPalette } from "@/components/command-palette";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type SessionUser = {
  email: string;
  name: string | null;
};

let listeners: Array<() => void> = [];
function subscribe(cb: () => void) {
  listeners.push(cb);
  return () => {
    listeners = listeners.filter((l) => l !== cb);
  };
}
function getPreference() {
  return localStorage.getItem("theme");
}
function getServerPreference() {
  return null;
}
function notify() {
  listeners.forEach((l) => l());
}

function AuthDialog({
  open,
  mode,
  onOpenChange,
  onAuthSuccess,
}: {
  open: boolean;
  mode: "signin" | "signup";
  onOpenChange: (open: boolean) => void;
  onAuthSuccess: (user: SessionUser) => void;
}) {
  const [activeMode, setActiveMode] = useState(mode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (open) {
      setActiveMode(mode);
      setError("");
    }
  }, [mode, open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError("");

    const endpoint = activeMode === "signup" ? "/api/auth/signup" : "/api/auth/signin";
    const body =
      activeMode === "signup"
        ? { name, email, password }
        : { email, password };

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Something went wrong");
        return;
      }

      onAuthSuccess(data.user);
      onOpenChange(false);
      setPassword("");
    } catch {
      setError("Unable to reach the server");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogTitle className="sr-only">
          {activeMode === "signup" ? "Create account" : "Sign in"}
        </DialogTitle>
        <DialogDescription className="sr-only">
          {activeMode === "signup"
            ? "Create an account for saved access and future user features."
            : "Sign in to your account."}
        </DialogDescription>

        <form onSubmit={handleSubmit} className="space-y-3">
          {activeMode === "signup" && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="auth-name">
                Name
              </label>
              <Input
                id="auth-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Supporter name"
                autoComplete="name"
              />
            </div>
          )}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="auth-email">
              Email
            </label>
            <Input
              id="auth-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="auth-password">
              Password
            </label>
            <Input
              id="auth-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={activeMode === "signup" ? "At least 8 characters" : "Your password"}
              autoComplete={activeMode === "signup" ? "new-password" : "current-password"}
              required
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={pending}>
            {pending
              ? activeMode === "signup"
                ? "Creating account..."
                : "Signing in..."
              : activeMode === "signup"
                ? "Create account"
                : "Sign in"}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            {activeMode === "signup" ? "Already have an account? " : "Don't have an account? "}
            <button
              type="button"
              className="font-medium text-foreground underline-offset-4 hover:underline"
              onClick={() => {
                setActiveMode(activeMode === "signup" ? "signin" : "signup");
                setError("");
              }}
            >
              {activeMode === "signup" ? "Sign in" : "Sign up"}
            </button>
          </p>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ActionsMenu({ trigger }: { trigger?: ReactElement } = {}) {
  const router = useRouter();
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);

  const preference = useSyncExternalStore(subscribe, getPreference, getServerPreference);
  const currentTheme = useSyncExternalStore(
    useCallback((cb: () => void) => {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    }, []),
    () => themeEffect(),
    () => "light",
  );

  useEffect(() => {
    let cancelled = false;

    async function loadSession() {
      try {
        const response = await fetch("/api/auth/session");
        const data = await response.json();
        if (!cancelled) {
          setUser(data.user ?? null);
        }
      } catch {
        if (!cancelled) {
          setUser(null);
        }
      } finally {
        if (!cancelled) {
          setLoadingUser(false);
        }
      }
    }

    loadSession();
    return () => {
      cancelled = true;
    };
  }, []);

  function cycleTheme() {
    const systemTheme = window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";

    let newPref: string | null;
    if (preference === null) {
      newPref = systemTheme === "dark" ? "light" : "dark";
    } else if (preference === "dark") {
      newPref = "light";
    } else {
      newPref = null;
    }

    if (newPref === null) {
      localStorage.removeItem("theme");
    } else {
      localStorage.setItem("theme", newPref);
    }
    themeEffect();
    notify();
  }

  async function signOut() {
    await fetch("/api/auth/signout", { method: "POST" });
    setUser(null);
    window.dispatchEvent(new CustomEvent("wiki-auth-session-change"));
  }

  function handleAuthSuccess(nextUser: SessionUser) {
    setUser(nextUser);
    window.dispatchEvent(new CustomEvent("wiki-auth-session-change"));
  }

  const themeLabel =
    preference === null ? "System" : preference === "dark" ? "Dark" : "Light";

  const defaultTrigger = (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Actions"
      data-test-id="header-actions-menu"
      className="text-[var(--text-muted)]"
    />
  );

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={trigger ?? defaultTrigger}>
          {trigger ? null : <EllipsisVertical />}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Search</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => router.push("/search")}>
              <Sparkles />
              AI Search
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push("/search?tab=text")}>
              <FileText />
              Text Search
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => openActionPalette()}>
            <Command />
            Command palette
            <span className="ml-auto text-xs text-muted-foreground">⌘K A</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => { window.location.href = "/api/download?type=full"; }}>
            <Download />
            Download wiki (full)
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => { window.location.href = "/api/download?type=markdown"; }}>
            <Download />
            Download wiki (markdown)
          </DropdownMenuItem>
          <DropdownMenuItem onClick={cycleTheme}>
            {currentTheme === "dark" ? <Sun /> : <Moon />}
            Theme: {themeLabel}
          </DropdownMenuItem>

          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel>Account</DropdownMenuLabel>

            {loadingUser ? (
              <DropdownMenuItem disabled>Loading account...</DropdownMenuItem>
            ) : user ? (
              <>
                <DropdownMenuItem disabled>{user.name || user.email}</DropdownMenuItem>
                <DropdownMenuItem onClick={signOut}>
                  <LogOut />
                  Sign out
                </DropdownMenuItem>
              </>
            ) : (
              <>
                <DropdownMenuItem
                  onClick={() => {
                    setAuthMode("signin");
                    setAuthDialogOpen(true);
                  }}
                >
                  <LogIn />
                  Sign in
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    setAuthMode("signup");
                    setAuthDialogOpen(true);
                  }}
                >
                  <UserPlus />
                  Sign up
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <AuthDialog
        open={authDialogOpen}
        mode={authMode}
        onOpenChange={setAuthDialogOpen}
        onAuthSuccess={handleAuthSuccess}
      />
    </>
  );
}
