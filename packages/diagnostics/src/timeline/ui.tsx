"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ButtonHTMLAttributes,
  type ComponentProps,
  type HTMLAttributes,
  type ReactNode,
} from "react";
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

const DialogCloseContext = createContext<(() => void) | null>(null);

/**
 * A native modal <dialog>: showModal() traps focus, makes the page behind it
 * inert, and handles Escape. The element itself is a transparent full-screen
 * layer, so a click outside DialogContent lands on it and closes.
 */
export function Dialog({
  children,
  onOpenChange,
  open,
}: {
  children: ReactNode;
  onOpenChange?: (open: boolean) => void;
  open: boolean;
}) {
  if (!open || typeof document === "undefined") return null;
  return <OpenDialog onClose={() => onOpenChange?.(false)}>{children}</OpenDialog>;
}

function OpenDialog({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    const previousFocus = document.activeElement as HTMLElement | null;
    element.showModal();
    return () => {
      element.close();
      previousFocus?.focus();
    };
  }, []);
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Backdrop click on a native modal; Escape and the Close button cover keyboards.
    <dialog
      className="m-0 h-full max-h-none w-full max-w-none border-0 bg-transparent p-0 backdrop:bg-black/10"
      data-slot="dialog"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      ref={dialog}
    >
      <DialogCloseContext.Provider value={onClose}>{children}</DialogCloseContext.Provider>
    </dialog>
  );
}

export function DialogContent({
  children,
  className,
  ...props
}: ComponentProps<"div">) {
  const close = useContext(DialogCloseContext);
  return (
    <div
      className={cn(
        "fixed left-1/2 top-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 outline-none sm:max-w-sm",
        className,
      )}
      {...props}
    >
      {children}
      <Button
        aria-label="Close"
        className="absolute right-2 top-2"
        onClick={() => close?.()}
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
