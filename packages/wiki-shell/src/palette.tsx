import { type ComponentProps } from "react";
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

export type WikiCommandEmptyProps = ComponentProps<"div">;

export function WikiCommandEmpty({ className, ...props }: WikiCommandEmptyProps) {
  return <div className={cn("wiki-shell-command-empty command-empty", className)} {...props} />;
}

export type WikiCommandFooterProps = ComponentProps<"footer">;

export function WikiCommandFooter({ className, ...props }: WikiCommandFooterProps) {
  return <footer className={cn("wiki-shell-command-footer command-footer", className)} {...props} />;
}
