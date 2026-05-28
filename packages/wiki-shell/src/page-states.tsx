import { type ComponentProps, type ReactNode } from "react";
import { cn } from "./utils";

export type WikiPageLoadingProps = ComponentProps<"div"> & {
  label?: ReactNode;
};

export function WikiPageLoading({
  className,
  label = "Loading page",
  ...props
}: WikiPageLoadingProps) {
  return (
    <div className={cn("wiki-shell-loading-line loading-line", className)} role="status" {...props}>
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        aria-hidden="true"
        className="wiki-shell-loading-icon"
      >
        <path d="M13.5 8a5.5 5.5 0 0 1-9.36 3.93" />
        <path d="M2.5 8a5.5 5.5 0 0 1 9.36-3.93" />
        <path d="M12 1.75v2.5h-2.5" />
        <path d="M4 14.25v-2.5h2.5" />
      </svg>
      {label}
    </div>
  );
}

export type WikiPageSkeletonProps = ComponentProps<"div"> & {
  includeTags?: boolean;
  label?: string;
};

export function WikiPageSkeleton({
  className,
  includeTags = false,
  label = "Loading page",
  ...props
}: WikiPageSkeletonProps) {
  return (
    <div
      aria-label={label}
      className={cn("wiki-shell-page-skeleton", className)}
      role="status"
      {...props}
    >
      <article className="wiki-shell-page-skeleton-article">
        <header className="wiki-shell-page-skeleton-header">
          <div className="wiki-shell-page-skeleton-title" />
          <div className="wiki-shell-page-skeleton-action" />
          {includeTags ? (
            <div className="wiki-shell-page-skeleton-tags">
              <span />
              <span />
            </div>
          ) : null}
        </header>
        <div className="wiki-shell-page-skeleton-body">
          <span />
          <span />
          <span />
          <strong />
          {includeTags ? (
            <>
              <span />
              <span />
            </>
          ) : null}
        </div>
      </article>
    </div>
  );
}

export type WikiEmptyAction = {
  key?: string;
  node: ReactNode;
};

export type WikiEmptyStateProps = ComponentProps<"article"> & {
  actions?: ReactNode;
  before?: ReactNode;
  children?: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  title: ReactNode;
};

export function WikiEmptyState({
  actions,
  before,
  children,
  className,
  description,
  eyebrow,
  title,
  ...props
}: WikiEmptyStateProps) {
  return (
    <article className={cn("wiki-shell-empty-state page-shell empty-state", className)} {...props}>
      {before}
      {eyebrow ? <div className="wiki-shell-empty-eyebrow">{eyebrow}</div> : null}
      <h1>{title}</h1>
      {description ? <p className="wiki-shell-muted muted">{description}</p> : null}
      {children}
      {actions ? <div className="wiki-shell-empty-actions empty-actions">{actions}</div> : null}
    </article>
  );
}
