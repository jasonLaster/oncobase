"use client";

import { type ReactElement, useCallback, useEffect, useState, useSyncExternalStore } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Command, Download, EllipsisVertical, FileText, LogIn, LogOut, Moon, ShieldCheck, Sparkles, Sun } from "lucide-react";
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

export type SessionUser = {
  email: string;
  name: string | null;
  isAdmin?: boolean;
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

export function useSessionUser() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);

  const loadSession = useCallback(async () => {
    setLoadingUser(true);
    try {
      const response = await fetch("/api/auth/session");
      const data = await response.json();
      setUser(data.user ?? null);
    } catch {
      setUser(null);
    } finally {
      setLoadingUser(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadInitialSession() {
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

    loadInitialSession();
    window.addEventListener("wiki-auth-session-change", loadSession);
    return () => {
      cancelled = true;
      window.removeEventListener("wiki-auth-session-change", loadSession);
    };
  }, [loadSession]);

  return { loadingUser, setUser, user };
}

export function AuthDialog({
  open,
  onOpenChange,
  onAuthSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAuthSuccess: (user: SessionUser) => void;
}) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (open) {
      setError("");
      setMode("signin");
    }
  }, [open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError("");

    try {
      const response = await fetch(
        mode === "signin" ? "/api/auth/signin" : "/api/auth/signup",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            mode === "signin" ? { email, password } : { email, name, password }
          ),
        }
      );
      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Something went wrong");
        return;
      }

      onAuthSuccess(data.user);
      onOpenChange(false);
      setPassword("");
      setName("");
    } catch {
      setError("Unable to reach the server");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-[760px]">
        <DialogTitle className="sr-only">
          {mode === "signin" ? "Sign in" : "Sign up"}
        </DialogTitle>
        <DialogDescription className="sr-only">
          {mode === "signin"
            ? "Sign in to your account."
            : "Create an account."}
        </DialogDescription>

        <div className="grid min-h-[430px] md:grid-cols-[minmax(0,1fr)_330px]">
          <div className="flex items-center p-5 sm:p-8">
            <div className="w-full">
              <div className="mb-6">
                <h2 className="text-xl font-semibold tracking-normal text-[var(--foreground)]">
                  {mode === "signin" ? "Welcome back" : "Create your account"}
                </h2>
                <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">
                  {mode === "signin"
                    ? "Sign in to comment and view additional content."
                    : "Join the wiki to comment and follow the work."}
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-3">
                {mode === "signup" ? (
                  <div className="space-y-1">
                    <label
                      className="text-xs font-medium text-muted-foreground"
                      htmlFor="auth-name"
                    >
                      Name
                    </label>
                    <Input
                      id="auth-name"
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Your name"
                      autoComplete="name"
                    />
                  </div>
                ) : null}
                <div className="space-y-1">
                  <label
                    className="text-xs font-medium text-muted-foreground"
                    htmlFor="auth-email"
                  >
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
                  <label
                    className="text-xs font-medium text-muted-foreground"
                    htmlFor="auth-password"
                  >
                    Password
                  </label>
                  <Input
                    id="auth-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" || pending) return;
                      e.preventDefault();
                      e.currentTarget.form?.requestSubmit();
                    }}
                    placeholder="Your password"
                    autoComplete={
                      mode === "signin" ? "current-password" : "new-password"
                    }
                    required
                  />
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
                <Button type="submit" className="w-full" disabled={pending}>
                  {pending
                    ? mode === "signin"
                      ? "Signing in..."
                      : "Signing up..."
                    : mode === "signin"
                      ? "Sign in"
                      : "Sign up"}
                </Button>
                <button
                  type="button"
                  onClick={() => {
                    setError("");
                    setMode((current) =>
                      current === "signin" ? "signup" : "signin"
                    );
                  }}
                  className="block w-full text-center text-sm font-medium text-[var(--brand)] hover:underline"
                >
                  {mode === "signin"
                    ? "Need an account? Sign up"
                    : "Already have an account? Sign in"}
                </button>
              </form>
            </div>
          </div>

          <div
            aria-hidden="true"
            className="hidden border-l border-[var(--sidebar-border)] bg-[var(--accent-light)]/45 p-4 md:flex md:items-center md:justify-center dark:bg-[var(--accent-light)]/30"
          >
            <Image
              src="/auth-wiki-cartoon-light.png"
              alt=""
              width={900}
              height={900}
              className="block h-auto w-full max-w-[290px] rounded-lg dark:hidden"
              draggable={false}
              unoptimized
            />
            <Image
              src="/auth-wiki-cartoon-dark.png"
              alt=""
              width={900}
              height={900}
              className="hidden h-auto w-full max-w-[290px] rounded-lg dark:block"
              draggable={false}
              unoptimized
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function SidebarSignInPrompt() {
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const { loadingUser, setUser, user } = useSessionUser();

  function handleAuthSuccess(nextUser: SessionUser) {
    setUser(nextUser);
    window.dispatchEvent(new CustomEvent("wiki-auth-session-change"));
  }

  if (loadingUser || user) return null;

  return (
    <>
      <div className="mb-2 rounded-lg border border-[var(--sidebar-border)] bg-[var(--popover)] p-3 shadow-sm">
        <p className="text-xs font-medium leading-snug text-[var(--foreground)]">
          Sign in to comment and view additional content
        </p>
        <button
          type="button"
          onClick={() => setAuthDialogOpen(true)}
          className="mt-2 flex w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-indigo-600 bg-indigo-600 px-2.5 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:border-indigo-700 hover:bg-indigo-700 hover:text-white active:bg-indigo-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:border-indigo-500 dark:bg-indigo-500 dark:text-white dark:hover:border-indigo-400 dark:hover:bg-indigo-400 dark:hover:text-white dark:active:bg-indigo-600 dark:focus-visible:outline-indigo-400"
          data-test-id="sidebar-sign-in"
        >
          <LogIn size={16} aria-hidden="true" />
          Sign in
        </button>
      </div>

      <AuthDialog
        open={authDialogOpen}
        onOpenChange={setAuthDialogOpen}
        onAuthSuccess={handleAuthSuccess}
      />
    </>
  );
}

export function ActionsMenu({ trigger }: { trigger?: ReactElement } = {}) {
  const router = useRouter();
  const { loadingUser, setUser, user } = useSessionUser();

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

          {loadingUser || user ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>Account</DropdownMenuLabel>

                {loadingUser ? (
                  <DropdownMenuItem disabled>Loading account...</DropdownMenuItem>
                ) : user ? (
                  <>
                    <DropdownMenuItem disabled>{user.name || user.email}</DropdownMenuItem>
                    {user.isAdmin ? (
                      <DropdownMenuItem onClick={() => router.push("/admin")}>
                        <ShieldCheck />
                        Admin
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuItem onClick={signOut}>
                      <LogOut />
                      Sign out
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuGroup>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

    </>
  );
}
