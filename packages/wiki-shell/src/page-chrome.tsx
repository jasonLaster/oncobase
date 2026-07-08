import {
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type ComponentProps,
  type Key,
  type ReactNode,
} from "react";
import { cn } from "./utils";

export type WikiBreadcrumbItem = {
  current?: boolean;
  href?: string;
  key?: Key;
  label: ReactNode;
};

export type WikiBreadcrumbsProps = Omit<ComponentProps<"nav">, "children"> & {
  items: WikiBreadcrumbItem[];
  renderLink?: (item: WikiBreadcrumbItem) => ReactNode;
  separator?: ReactNode;
};

export function WikiBreadcrumbs({
  className,
  items,
  renderLink,
  separator = "/",
  ...props
}: WikiBreadcrumbsProps) {
  return (
    <nav
      aria-label="Breadcrumbs"
      className={cn("wiki-shell-breadcrumbs breadcrumbs", className)}
      {...props}
    >
      <ol>
        {items.map((item, index) => (
          <li key={item.key ?? `${index}-${String(item.label)}`}>
            {index > 0 ? (
              <span
                className="wiki-shell-breadcrumb-separator breadcrumb-separator"
                aria-hidden="true"
              >
                {separator}
              </span>
            ) : null}
            {item.current ? (
              <span aria-current="page">{item.label}</span>
            ) : item.href ? (
              renderLink ? renderLink(item) : <a href={item.href}>{item.label}</a>
            ) : (
              <span>{item.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export type WikiPageHeaderProps = Omit<ComponentProps<"header">, "children" | "title"> & {
  actions?: ReactNode;
  badges?: ReactNode;
  description?: ReactNode;
  title: ReactNode;
};

export function WikiPageHeader({
  actions,
  badges,
  className,
  description,
  title,
  ...props
}: WikiPageHeaderProps) {
  return (
    <header className={cn("wiki-shell-page-header page-header", className)} {...props}>
      <div className="wiki-shell-page-header-main">
        <div className="wiki-shell-page-title-row">
          <h1>{title}</h1>
          {actions ? <div className="wiki-shell-page-inline-actions">{actions}</div> : null}
        </div>
        {description ? <p>{description}</p> : null}
      </div>
      {badges ? <div className="wiki-shell-page-badges page-badges">{badges}</div> : null}
    </header>
  );
}

export type WikiBadgeProps = ComponentProps<"span"> & {
  variant?: "default" | "updating" | "sensitive";
};

export function WikiBadge({ className, variant = "default", ...props }: WikiBadgeProps) {
  return <span className={cn("badge", variant !== "default" && variant, className)} {...props} />;
}

export type WikiPageActionsProps = ComponentProps<"div">;

export function WikiPageActions({ className, ...props }: WikiPageActionsProps) {
  return <div className={cn("wiki-shell-page-actions page-actions", className)} {...props} />;
}

export type WikiPageActionButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;

export function WikiPageActionButton({
  className,
  type = "button",
  ...props
}: WikiPageActionButtonProps) {
  return (
    <button
      className={cn("wiki-shell-page-action page-action", className)}
      type={type}
      {...props}
    />
  );
}

export type WikiPageActionLinkProps = AnchorHTMLAttributes<HTMLAnchorElement>;

export function WikiPageActionLink({ className, ...props }: WikiPageActionLinkProps) {
  return <a className={cn("wiki-shell-page-action page-action", className)} {...props} />;
}

export type WikiStatusNoticeProps = ComponentProps<"div"> & {
  tone?: "stale";
};

export function WikiStatusNotice({
  className,
  tone = "stale",
  ...props
}: WikiStatusNoticeProps) {
  return (
    <div
      className={cn("wiki-shell-status-notice", tone === "stale" && "stale-notice", className)}
      role="status"
      {...props}
    />
  );
}

export type WikiSourceLinkItem = {
  href: string;
  key?: Key;
  kind: ReactNode;
  label: ReactNode;
};

export type WikiSourceLinksProps = Omit<ComponentProps<"section">, "children"> & {
  items: WikiSourceLinkItem[];
  renderLink?: (item: WikiSourceLinkItem, children: ReactNode) => ReactNode;
  title?: ReactNode;
};

export function WikiSourceLinks({
  className,
  items,
  renderLink,
  title = "Source files",
  ...props
}: WikiSourceLinksProps) {
  if (items.length === 0) return null;

  return (
    <section
      aria-label={typeof title === "string" ? title : "Source files"}
      className={cn("wiki-shell-source-links source-links", className)}
      {...props}
    >
      <div className="wiki-shell-source-links-title source-links-title">{title}</div>
      <div className="wiki-shell-source-links-list source-links-list">
        {items.map((item) => {
          const children = (
            <>
              <span>{item.kind}</span>
              <strong>{item.label}</strong>
            </>
          );
          return renderLink ? (
            <div className="wiki-shell-source-link-wrapper" key={item.key ?? item.href}>
              {renderLink(item, children)}
            </div>
          ) : (
            <a key={item.key ?? item.href} href={item.href}>
              {children}
            </a>
          );
        })}
      </div>
    </section>
  );
}

export type WikiTagListProps = Omit<ComponentProps<"div">, "children"> & {
  renderTag?: (tag: string) => ReactNode;
  tags: string[];
};

export function WikiTagList({ className, renderTag, tags, ...props }: WikiTagListProps) {
  if (tags.length === 0) return null;

  return (
    <div className={cn("wiki-shell-tag-row tag-row", className)} {...props}>
      {tags.map((tag) => (renderTag ? renderTag(tag) : <span key={tag}>{tag}</span>))}
    </div>
  );
}

export type WikiPageFooterProps = Omit<ComponentProps<"footer">, "children"> & {
  items: ReactNode[];
};

export function WikiPageFooter({ className, items, ...props }: WikiPageFooterProps) {
  return (
    <footer className={cn("wiki-shell-page-footer page-footer", className)} {...props}>
      {items.map((item, index) => (
        <span key={index}>{item}</span>
      ))}
    </footer>
  );
}

export type WikiToastProps = ComponentProps<"div">;

export function WikiToast({ className, ...props }: WikiToastProps) {
  return <div className={cn("wiki-shell-toast toast", className)} role="status" {...props} />;
}

export async function copyTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}
