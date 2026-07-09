"use client";

import {
  useEffect,
  type ButtonHTMLAttributes,
  type ComponentProps,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { XIcon } from "lucide-react";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: Array<string | false | null | undefined>) {
  return twMerge(inputs.filter(Boolean).join(" "));
}

export function Badge({
  className,
  variant = "default",
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  variant?: "default" | "destructive" | "outline" | "secondary";
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-colors",
        variant === "destructive"
          ? "border-transparent bg-destructive/10 text-destructive"
          : variant === "outline"
            ? "border-border text-foreground"
            : variant === "secondary"
              ? "border-transparent bg-secondary text-secondary-foreground"
              : "border-transparent bg-primary text-primary-foreground",
        className,
      )}
      {...props}
    />
  );
}

const buttonVariantClass = {
  default: "bg-primary text-primary-foreground hover:bg-primary/90",
  ghost: "hover:bg-muted hover:text-foreground",
  outline:
    "border-border bg-background hover:border-primary/40 hover:bg-accent hover:text-primary",
  secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
};

const buttonSizeClass = {
  default: "h-8 gap-1.5 px-2.5",
  sm: "h-7 gap-1 px-2.5 text-[0.8rem]",
  "icon-sm": "size-7 rounded-md",
};

export function Button({
  className,
  size = "default",
  type = "button",
  variant = "default",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  size?: keyof typeof buttonSizeClass;
  variant?: keyof typeof buttonVariantClass;
}) {
  return (
    <button
      className={cn(
        "inline-flex shrink-0 cursor-pointer items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
        buttonVariantClass[variant],
        buttonSizeClass[size],
        className,
      )}
      type={type}
      {...props}
    />
  );
}

export function Dialog({
  children,
  onOpenChange,
  open,
}: {
  children: ReactNode;
  onOpenChange?: (open: boolean) => void;
  open: boolean;
}) {
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange?.(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onOpenChange, open]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div data-slot="dialog" role="presentation">
      <button
        aria-label="Close dialog"
        className="fixed inset-0 z-50 cursor-default bg-black/10"
        onClick={() => onOpenChange?.(false)}
        type="button"
      />
      {children}
    </div>,
    document.body,
  );
}

export function DialogContent({
  children,
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      aria-modal="true"
      className={cn(
        "fixed left-1/2 top-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 outline-none sm:max-w-sm",
        className,
      )}
      role="dialog"
      {...props}
    >
      {children}
      <Button
        aria-label="Close"
        className="absolute right-2 top-2"
        onClick={() => {
          document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        }}
        size="icon-sm"
        variant="ghost"
      >
        <XIcon className="size-4" />
      </Button>
    </div>
  );
}

export function DialogHeader({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-2", className)} {...props} />;
}

export function DialogTitle({ className, ...props }: ComponentProps<"h2">) {
  return (
    <h2
      className={cn("font-heading text-base font-medium leading-none", className)}
      {...props}
    />
  );
}
