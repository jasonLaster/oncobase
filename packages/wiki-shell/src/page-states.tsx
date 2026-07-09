import { type ComponentProps, type ReactNode } from "react";
import { cn } from "./utils.ts";

export type WikiPageLoadingProps = ComponentProps<"div"> & {
  "data-test-id"?: string;
  label?: ReactNode;
  includeTags?: boolean;
};

export function WikiPageLoading({
  className,
  includeTags = false,
  label = "Loading page",
  ...props
}: WikiPageLoadingProps) {
  const testId = props["data-test-id"];
  return (
    <div
      aria-label={typeof label === "string" ? label : "Loading page"}
      className={cn("wiki-shell-page-loading", className)}
      role="status"
      {...props}
    >
      <div className="wiki-shell-page-loading-inner">
        <div className="wiki-shell-page-loading-main">
          <WikiPageSkeleton
            data-test-id={typeof testId === "string" ? `${testId}-article` : undefined}
            includeTags={includeTags}
            label={typeof label === "string" ? label : "Loading page"}
          />
        </div>
      </div>
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

export type WikiMarkdownBodySkeletonProps = ComponentProps<"output">;

export function WikiMarkdownBodySkeleton({
  className,
  ...props
}: WikiMarkdownBodySkeletonProps) {
  return (
    <output
      aria-label="Loading page body"
      className={cn("wiki-shell-markdown-body-skeleton", className)}
      data-test-id="markdown-body-loading"
      {...props}
    >
      <div />
      <div />
      <div />
      <strong />
    </output>
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

export type WikiSensitiveUnavailableProps = Omit<ComponentProps<"main">, "title"> & {
  actions?: ReactNode;
  description?: ReactNode;
  slug?: ReactNode;
};

export function WikiSensitiveUnavailable({
  actions,
  className,
  description,
  slug,
  ...props
}: WikiSensitiveUnavailableProps) {
  return (
    <main className={cn("wiki-shell-sensitive-unavailable", className)} {...props}>
      <div className="wiki-shell-sensitive-unavailable-icon">
        <svg
          aria-hidden="true"
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
        >
          <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      </div>
      <h1>This page is private</h1>
      <p>
        {description ??
          "The page exists, but it is marked sensitive, so it is only available to signed-in readers with access. We keep these pages out of the public reader to avoid exposing private medical details, logistics, or confidential source material."}
      </p>
      {slug ? <p className="wiki-shell-sensitive-unavailable-slug">{slug}</p> : null}
      {actions ? <div className="wiki-shell-sensitive-unavailable-actions">{actions}</div> : null}
    </main>
  );
}
