import {
  CommandEmpty,
  CommandGroupLabel,
  CommandItem,
  CommandList,
} from "@oncobase/ui/command";
import { DialogBackdrop, DialogContent, DialogTitle } from "@oncobase/ui/dialog";
import {
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
} from "react";
import { cn } from "./utils.ts";

type ClassName<State> = string | ((state: State) => string | undefined);

function withClass<State>(base: string, className: ClassName<State> | undefined) {
  if (typeof className === "function") return (state: State) => cn(base, className(state));
  return cn(base, className);
}

export type WikiCommandBackdropProps = ComponentProps<typeof DialogBackdrop>;

export function WikiCommandBackdrop({ className, ...props }: WikiCommandBackdropProps) {
  return (
    <DialogBackdrop
      className={withClass("wiki-shell-command-backdrop command-backdrop", className)}
      {...props}
    />
  );
}

export type WikiCommandPanelProps = Omit<ComponentProps<typeof DialogContent>, "children"> & {
  children?: ReactNode;
  /** The dialog's accessible name, rendered as a visually hidden title. */
  title: string;
};

export function WikiCommandPanel({ children, className, title, ...props }: WikiCommandPanelProps) {
  return (
    <DialogContent
      className={withClass("wiki-shell-command-palette command-palette", className)}
      {...props}
    >
      {/* Not a heading: the reader's outline collects every heading on the page. */}
      <DialogTitle className="wiki-shell-sr-only" render={<div />}>{title}</DialogTitle>
      {children}
    </DialogContent>
  );
}

export type WikiCommandSearchProps = ComponentProps<"div">;

export function WikiCommandSearch({ className, ...props }: WikiCommandSearchProps) {
  return <div className={cn("wiki-shell-command-search command-search", className)} {...props} />;
}

export type WikiCommandListProps = ComponentProps<typeof CommandList>;

export function WikiCommandList({ className, ...props }: WikiCommandListProps) {
  return (
    <CommandList
      className={withClass("wiki-shell-command-list command-list", className)}
      {...props}
    />
  );
}

export type WikiCommandGroupHeadingProps = ComponentProps<typeof CommandGroupLabel>;

export function WikiCommandGroupHeading({ className, ...props }: WikiCommandGroupHeadingProps) {
  return (
    <CommandGroupLabel
      className={withClass("wiki-shell-command-group-heading", className)}
      {...props}
    />
  );
}

export type WikiCommandItemTextProps = ComponentProps<"span"> & {
  description?: ReactNode;
  label: ReactNode;
};

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

export type WikiCommandItemProps = Omit<ComponentProps<typeof CommandItem>, "children" | "label"> & {
  depth?: number;
  description?: ReactNode;
  /** Renders the command as a link; Enter follows it. */
  href?: string;
  icon?: ReactNode;
  label: string;
  rel?: string;
  target?: string;
};

export function WikiCommandItem({
  className,
  depth,
  description,
  href,
  icon,
  label,
  rel,
  render,
  style,
  target,
  ...props
}: WikiCommandItemProps) {
  const depthStyle = depth === undefined ? undefined : ({ "--outline-depth": depth } as CSSProperties);
  return (
    <CommandItem
      className={(state) =>
        cn(
          "wiki-shell-command-item",
          state.highlighted && "active",
          typeof className === "function" ? className(state) : className,
        )
      }
      label={label}
      render={render ?? (href ? ({ children, ...props }) => <a {...props} href={href} rel={rel} target={target}>{children}</a> : undefined)}
      style={depthStyle || style ? { ...depthStyle, ...(typeof style === "object" ? style : undefined) } : undefined}
      {...props}
    >
      {icon}
      <WikiCommandItemText description={description} label={label} />
    </CommandItem>
  );
}

export type WikiCommandEmptyProps = ComponentProps<typeof CommandEmpty>;

export function WikiCommandEmpty({ className, ...props }: WikiCommandEmptyProps) {
  return (
    <CommandEmpty
      className={withClass("wiki-shell-command-empty command-empty", className)}
      {...props}
    />
  );
}

export type WikiCommandFooterProps = ComponentProps<"footer">;

export function WikiCommandFooter({ className, ...props }: WikiCommandFooterProps) {
  return <footer className={cn("wiki-shell-command-footer command-footer", className)} {...props} />;
}
