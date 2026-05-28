import {
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type FormHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { cn } from "./utils";

export type WikiHeaderProps = Omit<React.ComponentProps<"header">, "children"> & {
  actions?: ReactNode;
  home: ReactNode;
  search: ReactNode;
};

export function WikiHeader({
  actions,
  className,
  home,
  search,
  ...props
}: WikiHeaderProps) {
  return (
    <header className={cn("wiki-shell-header", className)} {...props}>
      <div className="wiki-shell-header-home">{home}</div>
      <div className="wiki-shell-header-center">{search}</div>
      {actions ? <div className="wiki-shell-header-actions">{actions}</div> : null}
    </header>
  );
}

export type WikiLogoProps = React.ComponentProps<"svg"> & {
  dev?: boolean;
};

export function WikiLogo({ className, dev = false, ...props }: WikiLogoProps) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 32 32"
      className={cn("wiki-shell-logo", className)}
      aria-hidden="true"
      {...props}
    >
      <rect width="32" height="32" rx="6" fill={dev ? "#22c55e" : "#4f46e5"} />
      <text
        x="16"
        y="23"
        fill="white"
        fontFamily="system-ui, -apple-system, sans-serif"
        fontSize="22"
        fontWeight="700"
        textAnchor="middle"
      >
        D
      </text>
    </svg>
  );
}

export type WikiHeaderButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary" | "icon";
};

export function WikiHeaderButton({
  className,
  type = "button",
  variant = "default",
  ...props
}: WikiHeaderButtonProps) {
  return (
    <button
      className={cn("wiki-shell-header-button", `wiki-shell-header-button-${variant}`, className)}
      type={type}
      {...props}
    />
  );
}

export type WikiHeaderLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  variant?: "default" | "primary" | "icon";
};

export function WikiHeaderLink({
  className,
  variant = "default",
  ...props
}: WikiHeaderLinkProps) {
  return (
    <a
      className={cn("wiki-shell-header-button", `wiki-shell-header-button-${variant}`, className)}
      {...props}
    />
  );
}

export type WikiHeaderSearchFormProps = FormHTMLAttributes<HTMLFormElement> & {
  inputProps?: InputHTMLAttributes<HTMLInputElement>;
};

export function WikiHeaderSearchForm({
  children,
  className,
  inputProps,
  ...props
}: WikiHeaderSearchFormProps) {
  const { className: inputClassName, ...restInputProps } = inputProps ?? {};

  return (
    <form
      className={cn("wiki-shell-header-search", className)}
      data-test-id="header-search-form"
      role="search"
      {...props}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M15.25 14.19l-4.06-4.06a5.5 5.5 0 1 0-1.06 1.06l4.06 4.06a.75.75 0 1 0 1.06-1.06zM2 6.5a4.5 4.5 0 1 1 9 0 4.5 4.5 0 0 1-9 0z" />
      </svg>
      <input
        aria-label="Search wiki"
        data-test-id="header-search-input"
        name="q"
        placeholder="Search wiki..."
        type="search"
        {...restInputProps}
        className={cn(inputClassName)}
      />
      {children}
    </form>
  );
}
