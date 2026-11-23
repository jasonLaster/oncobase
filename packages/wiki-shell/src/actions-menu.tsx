import { Button } from "@oncobase/ui/button";
import {
  createDialogController,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@oncobase/ui/dialog";
import { Field, FieldLabel } from "@oncobase/ui/field";
import { Input } from "@oncobase/ui/input";
import {
  Menu,
  MenuContent,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from "@oncobase/ui/menu";
import {
  PasswordInput,
  PasswordInputControl,
  PasswordInputToggle,
} from "@oncobase/ui/password-input";
import {
  type FormEvent,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useState,
} from "react";
import { cn } from "./utils.ts";

export type WikiActionsMenuUser = {
  email: string;
  isAdmin?: boolean;
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
  /** Which edge of the trigger the menu lines up with. */
  align?: "center" | "end" | "start";
  className?: string;
  commandShortcut?: ReactNode;
  currentTheme?: "dark" | "light";
  downloadFullHref?: string;
  downloadMarkdownHref?: string;
  hideSignedOutAccountActions?: boolean;
  adminHref?: string;
  onNavigate?: (href: string) => void;
  searchHref?: string;
  onAuthSubmit?: (input: WikiActionsMenuAuthInput) => Promise<WikiActionsMenuUser>;
  onOpenCommandPalette?: () => void;
  onSessionChange?: (user: WikiActionsMenuUser | null) => void;
  onSignOut?: () => Promise<void> | void;
  onThemeToggle?: () => void;
  sessionLoading?: boolean;
  sessionUser?: WikiActionsMenuUser | null;
  sideOffset?: number;
  themeLabel?: string;
  textSearchHref?: string;
  /** A button element that opens the menu; the menu adds its ARIA and handlers. */
  trigger?: ReactElement;
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

function ShieldCheckIcon() {
  return (
    <Icon>
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1Z" />
      <path d="m9 12 2 2 4-4" />
    </Icon>
  );
}

function EyeIcon({ visible }: { visible: boolean }) {
  return visible ? (
    <Icon>
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="m2 2 20 20" />
    </Icon>
  ) : (
    <Icon>
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </Icon>
  );
}

export function WikiAuthDialog({
  initialMode,
  onAuthSubmit,
  onClose,
  onSessionChange,
  controller,
  open,
}: {
  /** Connects a `DialogTrigger` outside the dialog, which gets focus back when it closes. */
  controller?: ReturnType<typeof createDialogController>;
  initialMode: WikiActionsMenuAuthMode;
  onAuthSubmit?: (input: WikiActionsMenuAuthInput) => Promise<WikiActionsMenuUser>;
  onClose?: () => void;
  onSessionChange?: (user: WikiActionsMenuUser | null) => void;
  /** Leave it out when a `DialogTrigger` on the controller opens the dialog. */
  open?: boolean;
}) {
  const [mode, setMode] = useState<WikiActionsMenuAuthMode>(initialMode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [ownController] = useState(createDialogController);
  const dialog = controller ?? ownController;
  const [openedFor, setOpenedFor] = useState({ open, initialMode });
  const reset = () => {
    setMode(initialMode);
    setError("");
  };

  if (openedFor.open !== open || openedFor.initialMode !== initialMode) {
    setOpenedFor({ open, initialMode });
    if (open) reset();
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!onAuthSubmit) return;

    setPending(true);
    setError("");

    try {
      const user = await onAuthSubmit({ email, mode, name, password });
      onSessionChange?.(user);
      setPassword("");
      dialog.close();
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
    <Dialog
      controller={dialog}
      open={open}
      onOpenChange={(next) => {
        if (next) reset();
        else onClose?.();
      }}
    >
      <DialogContent className="wiki-shell-actions-dialog" data-test-id="wiki-auth-dialog">
        <DialogTitle className="wiki-shell-sr-only">
          {mode === "signin" ? "Sign in" : "Sign up"}
        </DialogTitle>
        <DialogDescription className="wiki-shell-sr-only">
          {mode === "signin" ? "Sign in to your account." : "Create an account."}
        </DialogDescription>

        <div className="wiki-shell-actions-auth-layout">
          <div className="wiki-shell-actions-auth-content">
            <div className="wiki-shell-actions-auth-inner">
              <div className="wiki-shell-actions-dialog-header">
                <h2>{mode === "signin" ? "Welcome back" : "Create your account"}</h2>
                <p>
                  {mode === "signin"
                    ? "Sign in to comment and view additional content."
                    : "Join the wiki to comment and follow the work."}
                </p>
              </div>

              <form className="wiki-shell-actions-auth-form" onSubmit={submit}>
                {mode === "signup" ? (
                  <Field className="wiki-shell-actions-auth-field">
                    <FieldLabel>Name</FieldLabel>
                    <Input
                      autoComplete="name"
                      id="auth-name"
                      placeholder="Your name"
                      type="text"
                      value={name}
                      onValueChange={setName}
                    />
                  </Field>
                ) : null}
                <Field className="wiki-shell-actions-auth-field">
                  <FieldLabel>Email</FieldLabel>
                  <Input
                    autoComplete="email"
                    id="auth-email"
                    placeholder="you@example.com"
                    required
                    type="email"
                    value={email}
                    onValueChange={setEmail}
                  />
                </Field>
                <Field className="wiki-shell-actions-auth-field">
                  <FieldLabel>Password</FieldLabel>
                  <PasswordInput
                    autoComplete={mode === "signup" ? "new-password" : "current-password"}
                    className="wiki-shell-actions-auth-password"
                    required
                    value={password}
                    onValueChange={setPassword}
                  >
                    <PasswordInputControl id="auth-password" placeholder="Your password" />
                    <PasswordInputToggle
                      aria-label="Show password"
                      className="wiki-shell-actions-auth-password-toggle"
                    >
                      {(state) => <EyeIcon visible={state.visible} />}
                    </PasswordInputToggle>
                  </PasswordInput>
                </Field>
                {error ? <p className="wiki-shell-actions-auth-error">{error}</p> : null}
                <Button className="wiki-shell-actions-auth-submit" disabled={pending} type="submit">
                  {pending
                    ? mode === "signup"
                      ? "Signing up..."
                      : "Signing in..."
                    : mode === "signup"
                      ? "Sign up"
                      : "Sign in"}
                </Button>
                <Button
                  className="wiki-shell-actions-auth-switch"
                  onClick={() => switchMode(mode === "signin" ? "signup" : "signin")}
                >
                  {mode === "signin"
                    ? "Need an account? Sign up"
                    : "Already have an account? Sign in"}
                </Button>
              </form>
            </div>
          </div>

          <div className="wiki-shell-actions-auth-art" aria-hidden="true">
            <img
              alt=""
              className="wiki-shell-actions-auth-art-light"
              draggable={false}
              height={900}
              src="/auth-wiki-cartoon-light.png"
              width={900}
            />
            <img
              alt=""
              className="wiki-shell-actions-auth-art-dark"
              draggable={false}
              height={900}
              src="/auth-wiki-cartoon-dark.png"
              width={900}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function WikiActionsMenu({
  align = "end",
  className,
  adminHref,
  commandShortcut = "⌘K A",
  currentTheme = "light",
  downloadFullHref = "/api/download?type=full",
  downloadMarkdownHref = "/api/download?type=markdown",
  hideSignedOutAccountActions = false,
  onAuthSubmit,
  onNavigate,
  onOpenCommandPalette,
  onSessionChange,
  onSignOut,
  onThemeToggle,
  searchHref,
  sessionLoading = false,
  sessionUser = null,
  sideOffset = 7,
  themeLabel = "System",
  textSearchHref,
  trigger,
}: WikiActionsMenuProps) {
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const [authMode, setAuthMode] = useState<WikiActionsMenuAuthMode>("signin");

  const openAuthDialog = (mode: WikiActionsMenuAuthMode) => {
    setAuthMode(mode);
    setAuthDialogOpen(true);
  };

  const showAccountGroup = sessionLoading || Boolean(sessionUser) || !hideSignedOutAccountActions;
  const linkItem = (href: string) => (onNavigate ? undefined : <a href={href} />);

  return (
    <>
      <div className={cn("wiki-shell-actions-menu", className)}>
        <Menu>
          {isValidElement(trigger) ? (
            <MenuTrigger render={trigger} />
          ) : (
            <MenuTrigger
              aria-label="Actions"
              className="wiki-shell-header-button wiki-shell-header-button-icon wiki-shell-actions-trigger"
              data-test-id="header-actions-menu"
            >
              <MenuIcon />
            </MenuTrigger>
          )}
          <MenuContent
            align={align}
            aria-label="Actions"
            aria-labelledby=""
            className="wiki-shell-actions-popover"
            side="bottom"
            sideOffset={sideOffset}
          >
            {searchHref || textSearchHref ? (
              <>
                <MenuGroup>
                  <MenuGroupLabel className="wiki-shell-actions-label">Search</MenuGroupLabel>
                  {searchHref ? (
                    <MenuItem
                      className="wiki-shell-actions-item"
                      render={linkItem(searchHref)}
                      onSelect={() => onNavigate?.(searchHref)}
                    >
                      <SparklesIcon />
                      <span>AI Search</span>
                    </MenuItem>
                  ) : null}
                  {textSearchHref ? (
                    <MenuItem
                      className="wiki-shell-actions-item"
                      render={linkItem(textSearchHref)}
                      onSelect={() => onNavigate?.(textSearchHref)}
                    >
                      <FileTextIcon />
                      <span>Text Search</span>
                    </MenuItem>
                  ) : null}
                </MenuGroup>
                <MenuSeparator className="wiki-shell-actions-separator" />
              </>
            ) : null}
            <MenuItem className="wiki-shell-actions-item" onSelect={() => onOpenCommandPalette?.()}>
              <CommandIcon />
              <span>Command palette</span>
              <span className="wiki-shell-actions-shortcut">{commandShortcut}</span>
            </MenuItem>
            <MenuSeparator className="wiki-shell-actions-separator" />
            <MenuItem className="wiki-shell-actions-item" render={<a href={downloadFullHref} />}>
              <DownloadIcon />
              <span>Download wiki (full)</span>
            </MenuItem>
            <MenuItem className="wiki-shell-actions-item" render={<a href={downloadMarkdownHref} />}>
              <DownloadIcon />
              <span>Download wiki (markdown)</span>
            </MenuItem>
            <MenuItem className="wiki-shell-actions-item" onSelect={() => onThemeToggle?.()}>
              <ThemeIcon currentTheme={currentTheme} />
              <span>Theme: {themeLabel}</span>
            </MenuItem>
            {showAccountGroup ? (
              <>
                <MenuSeparator className="wiki-shell-actions-separator" />
                <MenuGroup>
                  <MenuGroupLabel className="wiki-shell-actions-label">Account</MenuGroupLabel>
                  {sessionLoading ? (
                    <MenuItem className="wiki-shell-actions-item" disabled>
                      Loading account...
                    </MenuItem>
                  ) : sessionUser ? (
                    <>
                      <MenuItem className="wiki-shell-actions-item" disabled>
                        {sessionUser.name || sessionUser.email}
                      </MenuItem>
                      {sessionUser.isAdmin && adminHref ? (
                        <MenuItem className="wiki-shell-actions-item" render={<a href={adminHref} />}>
                          <ShieldCheckIcon />
                          <span>Admin</span>
                        </MenuItem>
                      ) : null}
                      <MenuItem
                        className="wiki-shell-actions-item"
                        onSelect={async () => {
                          await onSignOut?.();
                          onSessionChange?.(null);
                        }}
                      >
                        <SignOutIcon />
                        <span>Sign out</span>
                      </MenuItem>
                    </>
                  ) : (
                    <>
                      <MenuItem className="wiki-shell-actions-item" onSelect={() => openAuthDialog("signin")}>
                        <SignInIcon />
                        <span>Sign in</span>
                      </MenuItem>
                      <MenuItem className="wiki-shell-actions-item" onSelect={() => openAuthDialog("signup")}>
                        <UserPlusIcon />
                        <span>Sign up</span>
                      </MenuItem>
                    </>
                  )}
                </MenuGroup>
              </>
            ) : null}
          </MenuContent>
        </Menu>
      </div>
      <WikiAuthDialog
        initialMode={authMode}
        onAuthSubmit={onAuthSubmit}
        onClose={() => setAuthDialogOpen(false)}
        onSessionChange={onSessionChange}
        open={authDialogOpen}
      />
    </>
  );
}

export type WikiSidebarSignInPromptProps = {
  hideWhileLoading?: boolean;
  onAuthSubmit?: (input: WikiActionsMenuAuthInput) => Promise<WikiActionsMenuUser>;
  onSessionChange?: (user: WikiActionsMenuUser | null) => void;
  sessionLoading?: boolean;
  sessionUser?: WikiActionsMenuUser | null;
};

export function WikiSidebarSignInPrompt({
  onAuthSubmit,
  onSessionChange,
  sessionUser = null,
  sessionLoading = false,
  hideWhileLoading = false,
}: WikiSidebarSignInPromptProps) {
  const [controller] = useState(createDialogController);

  // Match the initial reader until a signed-in account is confirmed.
  if (sessionUser || (sessionLoading && hideWhileLoading)) return null;

  return (
    <>
      <div className="wiki-shell-sidebar-sign-in">
        <p>Sign in to comment and view additional content</p>
        <DialogTrigger controller={controller} data-test-id="sidebar-sign-in">
          <SignInIcon />
          <span>Sign in</span>
        </DialogTrigger>
      </div>
      <WikiAuthDialog
        controller={controller}
        initialMode="signin"
        onAuthSubmit={onAuthSubmit}
        onSessionChange={onSessionChange}
      />
    </>
  );
}
