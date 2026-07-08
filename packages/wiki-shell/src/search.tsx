import {
  type ButtonHTMLAttributes,
  type ComponentProps,
  type FormHTMLAttributes,
  type InputHTMLAttributes,
  type Key,
  type ReactNode,
} from "react";
import { cn } from "./utils.ts";

export type WikiSearchPageProps = ComponentProps<"article">;

export function WikiSearchPage({ className, ...props }: WikiSearchPageProps) {
  return <article className={cn("wiki-shell-search-page search-page", className)} {...props} />;
}

export type WikiSearchHeaderProps = Omit<ComponentProps<"header">, "children"> & {
  action?: ReactNode;
  eyebrow?: ReactNode;
  heading: ReactNode;
};

export function WikiSearchHeader({
  action,
  className,
  eyebrow,
  heading,
  ...props
}: WikiSearchHeaderProps) {
  return (
    <header className={cn("wiki-shell-search-header search-page-header", className)} {...props}>
      {eyebrow ? <p className="wiki-shell-search-eyebrow eyebrow">{eyebrow}</p> : null}
      <h1>{heading}</h1>
      {action}
    </header>
  );
}

export type WikiSearchFormProps = FormHTMLAttributes<HTMLFormElement>;

export function WikiSearchForm({ className, ...props }: WikiSearchFormProps) {
  return <form className={cn("wiki-shell-search-form search-page-form", className)} {...props} />;
}

export type WikiSearchInputProps = InputHTMLAttributes<HTMLInputElement>;

export function WikiSearchInput({ className, ...props }: WikiSearchInputProps) {
  return <input className={cn("wiki-shell-search-input", className)} {...props} />;
}

export type WikiSearchSubmitButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;

export function WikiSearchSubmitButton({
  className,
  type = "submit",
  ...props
}: WikiSearchSubmitButtonProps) {
  return (
    <button
      className={cn("wiki-shell-search-submit", className)}
      type={type}
      {...props}
    />
  );
}

export type WikiSearchModeOption = {
  key: Key;
  label: ReactNode;
  onSelect: () => void;
  pressed: boolean;
};

export type WikiSearchModeToggleProps = Omit<ComponentProps<"div">, "children"> & {
  options: WikiSearchModeOption[];
};

export function WikiSearchModeToggle({
  className,
  options,
  ...props
}: WikiSearchModeToggleProps) {
  return (
    <div
      aria-label="Search mode"
      className={cn("wiki-shell-search-mode-toggle search-mode-toggle", className)}
      role="group"
      {...props}
    >
      {options.map((option) => (
        <button
          aria-pressed={option.pressed}
          key={option.key}
          onClick={option.onSelect}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export type WikiSearchResultsProps = ComponentProps<"section"> & {
  emptyMessage?: ReactNode;
  error?: ReactNode;
  statusLabel: ReactNode;
};

export function WikiSearchResults({
  children,
  className,
  emptyMessage,
  error,
  statusLabel,
  ...props
}: WikiSearchResultsProps) {
  return (
    <section className={cn("wiki-shell-search-results search-page-results", className)} {...props}>
      <div className="wiki-shell-search-status search-page-status" role="status">
        {statusLabel}
      </div>
      {error ? <p className="wiki-shell-search-error auth-error">{error}</p> : null}
      {emptyMessage ? (
        <p className="wiki-shell-search-empty search-page-empty">{emptyMessage}</p>
      ) : null}
      {children}
    </section>
  );
}

export type WikiSearchResultLinkRenderProps =
  Omit<ComponentProps<"a">, "children" | "ref"> & {
    children: ReactNode;
    "data-active"?: "true";
    href: string;
  };

export type WikiSearchResultLinkProps =
  Omit<ComponentProps<"a">, "children" | "href" | "title"> & {
    active?: boolean;
    excerpt?: ReactNode;
    href: string;
    relevance?: number;
    renderLink?: (props: WikiSearchResultLinkRenderProps) => ReactNode;
    sensitive?: boolean;
    slug: ReactNode;
    sources?: Array<{ label?: ReactNode; title: ReactNode; href?: string }>;
    summary?: ReactNode;
    tags?: string[];
    title: ReactNode;
  };

export function WikiSearchResultLink({
  active,
  className,
  excerpt,
  href,
  relevance,
  renderLink,
  sensitive,
  slug,
  sources,
  summary,
  tags,
  title,
  ...props
}: WikiSearchResultLinkProps) {
  const children = (
    <>
      <strong>{title}</strong>
      <span>
        {slug}
        {typeof relevance === "number" ? ` · ${relevance.toFixed(1)} relevance` : ""}
      </span>
      <div className="wiki-shell-search-result-meta">
        {sensitive ? <small className="badge sensitive">sensitive</small> : null}
        {tags && tags.length > 0 ? <small>{tags.slice(0, 3).join(" / ")}</small> : null}
      </div>
      {summary ? <p>{summary}</p> : excerpt ? <p>{excerpt}</p> : null}
      {sources && sources.length > 0 ? (
        <div
          aria-label="Result sources"
          className="wiki-shell-search-result-sources"
        >
          {sources.slice(0, 3).map((source, index) => (
            <small key={`${source.href ?? index}-${index}`}>
              {source.label ? <span>{source.label}</span> : null}
              {source.title}
            </small>
          ))}
        </div>
      ) : null}
    </>
  );
  const linkProps: WikiSearchResultLinkRenderProps = {
    ...props,
    "data-active": active ? "true" : undefined,
    className: cn("wiki-shell-search-result search-page-result", active && "active", className),
    children,
    href,
  };

  if (renderLink) return renderLink(linkProps);

  return <a {...linkProps} />;
}
