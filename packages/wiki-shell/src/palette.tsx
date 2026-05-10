import {
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
} from "react";
import { cn } from "./utils";

export type WikiCommandBackdropProps = ComponentProps<"div">;

export function WikiCommandBackdrop({
  className,
  ...props
}: WikiCommandBackdropProps) {
  return <div className={cn("wiki-shell-command-backdrop command-backdrop", className)} {...props} />;
}

export type WikiCommandPanelProps = ComponentProps<"section">;

export function WikiCommandPanel({ className, ...props }: WikiCommandPanelProps) {
  return <section className={cn("wiki-shell-command-palette command-palette", className)} {...props} />;
}

export type WikiCommandSearchProps = ComponentProps<"div">;

export function WikiCommandSearch({ className, ...props }: WikiCommandSearchProps) {
  return <div className={cn("wiki-shell-command-search command-search", className)} {...props} />;
}

export type WikiCommandTabsProps = ComponentProps<"div">;

export function WikiCommandTabs({ className, ...props }: WikiCommandTabsProps) {
  return <div className={cn("wiki-shell-command-tabs command-tabs", className)} {...props} />;
}

export type WikiCommandListProps = ComponentProps<"div">;

export function WikiCommandList({ className, ...props }: WikiCommandListProps) {
  return <div className={cn("wiki-shell-command-list command-list", className)} {...props} />;
}

export type WikiCommandItemContentProps = {
  active?: boolean;
  depth?: number;
  description?: ReactNode;
  icon?: ReactNode;
  label: ReactNode;
};

export type WikiCommandItemTextProps = ComponentProps<"span"> & {
  description?: ReactNode;
  label: ReactNode;
};

function commandItemStyle(style: CSSProperties | undefined, depth: number | undefined) {
  if (depth === undefined) return style;
  return { ...style, "--outline-depth": depth } as CSSProperties;
}

export function WikiCommandItemText({
  className,
  description,
  label,
  ...props
}: WikiCommandItemTextProps) {
  return (
    <span className={cn("wiki-shell-command-item-text", className)} {...props}>
      <strong>{label}</strong>
      {description ? <small>{description}</small> : null}
    </span>
  );
}

export type WikiCommandItemButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children"
> &
  WikiCommandItemContentProps;

export function WikiCommandItemButton({
  active = false,
  className,
  depth,
  description,
  icon,
  label,
  style,
  type = "button",
  ...props
}: WikiCommandItemButtonProps) {
  return (
    <button
      {...props}
      aria-selected={active}
      className={cn("wiki-shell-command-item", active && "active", className)}
      data-active={active ? "true" : undefined}
      style={commandItemStyle(style, depth)}
      type={type}
    >
      {icon}
      <WikiCommandItemText description={description} label={label} />
    </button>
  );
}

export type WikiCommandItemLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "children"> &
  WikiCommandItemContentProps & {
    href: string;
  };

export function WikiCommandItemLink({
  active = false,
  className,
  depth,
  description,
  icon,
  label,
  style,
  ...props
}: WikiCommandItemLinkProps) {
  return (
    <a
      {...props}
      aria-selected={active}
      className={cn("wiki-shell-command-item", active && "active", className)}
      data-active={active ? "true" : undefined}
      style={commandItemStyle(style, depth)}
    >
      {icon}
      <WikiCommandItemText description={description} label={label} />
    </a>
  );
}

export type WikiCommandEmptyProps = ComponentProps<"div">;

export function WikiCommandEmpty({ className, ...props }: WikiCommandEmptyProps) {
  return <div className={cn("wiki-shell-command-empty command-empty", className)} {...props} />;
}

export type WikiCommandFooterProps = ComponentProps<"footer">;

export function WikiCommandFooter({ className, ...props }: WikiCommandFooterProps) {
  return <footer className={cn("wiki-shell-command-footer command-footer", className)} {...props} />;
}
