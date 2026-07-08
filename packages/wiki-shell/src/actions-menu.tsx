import {
  cloneElement,
  type FormEvent,
  isValidElement,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { cn } from "./utils.ts";

export type WikiActionsMenuUser = {
  email: string;
  name: string | null;
};

export type WikiActionsMenuAuthMode = "signin" | "signup";

export type WikiActionsMenuAuthInput = {
  email: string;
  mode: WikiActionsMenuAuthMode;
  name?: string;
  password: string;
};

export type WikiActionsMenuProps = {
  className?: string;
  commandShortcut?: ReactNode;
  currentTheme?: "dark" | "light";
  downloadFullHref?: string;
  downloadMarkdownHref?: string;
  searchHref?: string;
  onAuthSubmit?: (input: WikiActionsMenuAuthInput) => Promise<WikiActionsMenuUser>;
  onOpenCommandPalette?: () => void;
  onSessionChange?: (user: WikiActionsMenuUser | null) => void;
  onSignOut?: () => Promise<void> | void;
  onThemeToggle?: () => void;
  sessionLoading?: boolean;
  sessionUser?: WikiActionsMenuUser | null;
  themeLabel?: string;
  textSearchHref?: string;
  trigger?: ReactElement<{
    "aria-expanded"?: boolean;
    "aria-haspopup"?: "menu";
    onClick?: (event: MouseEvent) => void;
  }>;
};

function Icon({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      className={cn("wiki-shell-actions-icon", className)}
      fill="none"
      height="16"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      width="16"
    >
      {children}
    </svg>
  );
}

function MenuIcon() {
  return (
    <Icon>
      <circle cx="12" cy="12" r="1" />
      <circle cx="12" cy="5" r="1" />
      <circle cx="12" cy="19" r="1" />
    </Icon>
  );
}

function CommandIcon() {
  return (
    <Icon>
      <path d="M9 9H5.5a2.5 2.5 0 1 1 2.5-2.5V18a2.5 2.5 0 1 1-2.5-2.5H18a2.5 2.5 0 1 1-2.5 2.5V6.5A2.5 2.5 0 1 1 18 9H6" />
    </Icon>
  );
}

function SparklesIcon() {
  return (
    <Icon>
      <path d="M12 3l1.45 4.55L18 9l-4.55 1.45L12 15l-1.45-4.55L6 9l4.55-1.45L12 3Z" />
      <path d="M19 15l.7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7L19 15Z" />
      <path d="M5 14l.55 1.45L7 16l-1.45.55L5 18l-.55-1.45L3 16l1.45-.55L5 14Z" />
    </Icon>
  );
}

function FileTextIcon() {
  return (
    <Icon>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v6h6" />
      <path d="M8 13h8" />
      <path d="M8 17h6" />
    </Icon>
  );
}

function DownloadIcon() {
  return (
    <Icon>
      <path d="M12 3v11" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </Icon>
  );
}

function ThemeIcon({ currentTheme }: { currentTheme?: "dark" | "light" }) {
  return currentTheme === "dark" ? (
    <Icon>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </Icon>
  ) : (
    <Icon>
      <path d="M12 3a6 6 0 0 0 9 7.5A9 9 0 1 1 12 3Z" />
    </Icon>
  );
}

function SignInIcon() {
  return (
    <Icon>
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
      <path d="m10 17 5-5-5-5" />
      <path d="M15 12H3" />
    </Icon>
  );
}

function SignOutIcon() {
  return (
    <Icon>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </Icon>
  );
}

function UserPlusIcon() {
  return (
    <Icon>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M19 8v6" />
      <path d="M22 11h-6" />
    </Icon>
  );
}

function MenuButton({
  children,
  disabled,
  href,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  href?: string;
  onClick?: () => void;
}) {
  if (href) {
    return (
      <a className="wiki-shell-actions-item" href={href} role="menuitem" onClick={onClick}>
        {children}
      </a>
    );
  }

  return (
    <button
      aria-disabled={disabled ? "true" : undefined}
      className="wiki-shell-actions-item"
      disabled={disabled}
      role="menuitem"
      type="button"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function AuthDialog({
  initialMode,
  onAuthSubmit,
  onClose,
  onSessionChange,
  open,
}: {
  initialMode: WikiActionsMenuAuthMode;
  onAuthSubmit?: (input: WikiActionsMenuAuthInput) => Promise<WikiActionsMenuUser>;
  onClose: () => void;
  onSessionChange?: (user: WikiActionsMenuUser | null) => void;
  open: boolean;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const [mode, setMode] = useState<WikiActionsMenuAuthMode>(initialMode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMode(initialMode);
    setError("");
  }, [initialMode, open]);

  if (!open) return null;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!onAuthSubmit) return;

    setPending(true);
    setError("");

    try {
      const user = await onAuthSubmit({ email, mode, name, password });
      onSessionChange?.(user);
      setPassword("");
      onClose();
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "Something went wrong");
    } finally {
      setPending(false);
    }
  };

  const switchMode = (nextMode: WikiActionsMenuAuthMode) => {
    setMode(nextMode);
    setError("");
  };

  return (
    <div
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      aria-modal="true"
      className="wiki-shell-actions-dialog-backdrop"
      role="dialog"
      onMouseDown={onClose}
    >
      <div className="wiki-shell-actions-dialog" onMouseDown={(event) => event.stopPropagation()}>
        <div className="wiki-shell-actions-dialog-header">
          <h2 id={titleId}>{mode === "signup" ? "Create account" : "Sign in"}</h2>
          <p id={descriptionId}>
            Wiki viewing still uses the shared password. This account is for saved access and future user features.
          </p>
        </div>

        <div className="wiki-shell-actions-auth-tabs" role="tablist" aria-label="Authentication mode">
          <button
            aria-selected={mode === "signin"}
            role="tab"
            type="button"
            onClick={() => switchMode("signin")}
          >
            Sign in
          </button>
          <button
            aria-selected={mode === "signup"}
            role="tab"
            type="button"
            onClick={() => switchMode("signup")}
          >
            Sign up
          </button>
        </div>

        <form className="wiki-shell-actions-auth-form" onSubmit={submit}>
          {mode === "signup" ? (
            <label>
              <span>Name</span>
              <input
                autoComplete="name"
                id="auth-name"
                placeholder="Supporter name"
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
              />
            </label>
          ) : null}
          <label>
            <span>Email</span>
            <input
              autoComplete="email"
              id="auth-email"
              placeholder="you@example.com"
              required
              type="email"
              value={email}
              onChange={(event) => setEmail(event.currentTarget.value)}
            />
          </label>
          <label>
            <span>Password</span>
            <input
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              id="auth-password"
              placeholder={mode === "signup" ? "At least 8 characters" : "Your password"}
              required
              type="password"
              value={password}
              onChange={(event) => setPassword(event.currentTarget.value)}
            />
          </label>
          {error ? <p className="wiki-shell-actions-auth-error">{error}</p> : null}
          <button className="wiki-shell-actions-auth-submit" disabled={pending} type="submit">
            {pending
              ? mode === "signup"
                ? "Creating account..."
                : "Signing in..."
              : mode === "signup"
                ? "Create account"
                : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}

export function WikiActionsMenu({
  className,
  commandShortcut = "⌘K A",
  currentTheme = "light",
  downloadFullHref = "/api/download?type=full",
  downloadMarkdownHref = "/api/download?type=markdown",
  onAuthSubmit,
  onOpenCommandPalette,
  onSessionChange,
  onSignOut,
  onThemeToggle,
  searchHref,
  sessionLoading = false,
  sessionUser = null,
  themeLabel = "System",
  textSearchHref,
  trigger,
}: WikiActionsMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const [authMode, setAuthMode] = useState<WikiActionsMenuAuthMode>("signin");

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const openAuthDialog = (mode: WikiActionsMenuAuthMode) => {
    setAuthMode(mode);
    setAuthDialogOpen(true);
    setOpen(false);
  };

  const signOut = async () => {
    await onSignOut?.();
    onSessionChange?.(null);
    setOpen(false);
  };

  const triggerElement = isValidElement(trigger) ? (
    cloneElement(trigger, {
      "aria-expanded": open,
      "aria-haspopup": "menu",
      onClick: (event: MouseEvent) => {
        trigger.props.onClick?.(event);
        if (!event.defaultPrevented) setOpen((value) => !value);
      },
    })
  ) : (
    <button
      aria-expanded={open}
      aria-haspopup="menu"
      aria-label="Actions"
      className="wiki-shell-header-button wiki-shell-header-button-icon wiki-shell-actions-trigger"
      data-test-id="header-actions-menu"
      type="button"
      onClick={() => setOpen((value) => !value)}
    >
      <MenuIcon />
    </button>
  );

  return (
    <>
      <div className={cn("wiki-shell-actions-menu", className)} ref={rootRef}>
        {triggerElement}
        {open ? (
          <div className="wiki-shell-actions-popover" role="menu" aria-label="Actions">
            {searchHref || textSearchHref ? (
              <>
                <div className="wiki-shell-actions-label">Search</div>
                {searchHref ? (
                  <MenuButton href={searchHref} onClick={() => setOpen(false)}>
                    <SparklesIcon />
                    <span>AI Search</span>
                  </MenuButton>
                ) : null}
                {textSearchHref ? (
                  <MenuButton href={textSearchHref} onClick={() => setOpen(false)}>
                    <FileTextIcon />
                    <span>Text Search</span>
                  </MenuButton>
                ) : null}
                <div className="wiki-shell-actions-separator" role="separator" />
              </>
            ) : null}
            <MenuButton
              onClick={() => {
                setOpen(false);
                onOpenCommandPalette?.();
              }}
            >
              <CommandIcon />
              <span>Command palette</span>
              <span className="wiki-shell-actions-shortcut">{commandShortcut}</span>
            </MenuButton>
            <div className="wiki-shell-actions-separator" role="separator" />
            <MenuButton href={downloadFullHref} onClick={() => setOpen(false)}>
              <DownloadIcon />
              <span>Download wiki (full)</span>
            </MenuButton>
            <MenuButton href={downloadMarkdownHref} onClick={() => setOpen(false)}>
              <DownloadIcon />
              <span>Download wiki (markdown)</span>
            </MenuButton>
            <MenuButton
              onClick={() => {
                onThemeToggle?.();
                setOpen(false);
              }}
            >
              <ThemeIcon currentTheme={currentTheme} />
              <span>Theme: {themeLabel}</span>
            </MenuButton>
            <div className="wiki-shell-actions-separator" role="separator" />
            <div className="wiki-shell-actions-label">Account</div>
            {sessionLoading ? (
              <MenuButton disabled>Loading account...</MenuButton>
            ) : sessionUser ? (
              <>
                <MenuButton disabled>{sessionUser.name || sessionUser.email}</MenuButton>
                <MenuButton onClick={signOut}>
                  <SignOutIcon />
                  <span>Sign out</span>
                </MenuButton>
              </>
            ) : (
              <>
                <MenuButton onClick={() => openAuthDialog("signin")}>
                  <SignInIcon />
                  <span>Sign in</span>
                </MenuButton>
                <MenuButton onClick={() => openAuthDialog("signup")}>
                  <UserPlusIcon />
                  <span>Sign up</span>
                </MenuButton>
              </>
            )}
          </div>
        ) : null}
      </div>
      <AuthDialog
        initialMode={authMode}
        onAuthSubmit={onAuthSubmit}
        onClose={() => setAuthDialogOpen(false)}
        onSessionChange={onSessionChange}
        open={authDialogOpen}
      />
    </>
  );
}
