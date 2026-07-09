import { type ComponentProps, type ReactNode } from "react";
import { cn } from "./utils.ts";

export type WikiChatPageProps = ComponentProps<"section">;

export function WikiChatPage({ className, ...props }: WikiChatPageProps) {
  return <section className={cn("wiki-shell-chat-page vite-chat-page", className)} {...props} />;
}

export type WikiChatSidebarProps = ComponentProps<"aside">;

export function WikiChatSidebar({ className, ...props }: WikiChatSidebarProps) {
  return <aside className={cn("wiki-shell-chat-sidebar vite-chat-sidebar", className)} {...props} />;
}

export type WikiChatListProps = ComponentProps<"nav">;

export function WikiChatList({ className, ...props }: WikiChatListProps) {
  return <nav className={cn("wiki-shell-chat-list vite-chat-list", className)} {...props} />;
}

export type WikiChatListLinkRenderProps =
  Omit<ComponentProps<"a">, "children" | "ref"> & {
    children: ReactNode;
    href: string;
  };

export type WikiChatListLinkProps =
  Omit<ComponentProps<"a">, "children" | "href"> & {
    active?: boolean;
    children: ReactNode;
    href: string;
    renderLink?: (props: WikiChatListLinkRenderProps) => ReactNode;
    variant?: "new" | "item";
  };

export function WikiChatListLink({
  active,
  children,
  className,
  href,
  renderLink,
  variant = "item",
  ...props
}: WikiChatListLinkProps) {
  const linkProps: WikiChatListLinkRenderProps = {
    ...props,
    className: cn(
      variant === "new"
        ? "wiki-shell-chat-list-new vite-chat-list-new"
        : "wiki-shell-chat-list-item vite-chat-list-item",
      active && "active",
      className,
    ),
    children,
    href,
  };

  if (renderLink) return renderLink(linkProps);

  return <a {...linkProps} />;
}

export type WikiChatMutedProps = ComponentProps<"p">;

export function WikiChatMuted({ className, ...props }: WikiChatMutedProps) {
  return <p className={cn("wiki-shell-chat-muted vite-chat-muted", className)} {...props} />;
}

export type WikiChatMainProps = ComponentProps<"div">;

export function WikiChatMain({ className, ...props }: WikiChatMainProps) {
  return <div className={cn("wiki-shell-chat-main vite-chat-main", className)} {...props} />;
}

export type WikiChatStateProps = ComponentProps<"section"> & {
  heading?: ReactNode;
  kind?: "placeholder" | "loading";
};

export function WikiChatState({
  children,
  className,
  heading,
  kind = "loading",
  ...props
}: WikiChatStateProps) {
  return (
    <section
      className={cn(
        kind === "placeholder"
          ? "wiki-shell-chat-placeholder vite-chat-placeholder"
          : "wiki-shell-chat-loading vite-chat-loading",
        className,
      )}
      {...props}
    >
      {heading ? <h1>{heading}</h1> : null}
      {children}
    </section>
  );
}

export type WikiChatLoadingSkeletonProps = ComponentProps<"div">;

export function WikiChatLoadingSkeleton({
  className,
  ...props
}: WikiChatLoadingSkeletonProps) {
  return (
    <div
      aria-label="Loading chat"
      className={cn("wiki-shell-chat-loading-skeleton", className)}
      data-test-id="chat-loading"
      role="status"
      {...props}
    >
      <div className="wiki-shell-chat-loading-title" />
      <div className="wiki-shell-chat-loading-messages">
        <div />
        <div />
        <div />
      </div>
    </div>
  );
}
