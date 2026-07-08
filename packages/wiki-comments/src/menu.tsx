"use client";

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { cn } from "./utils";

type DropdownMenuContextValue = {
  contentId: string;
  open: boolean;
  setOpen: (open: boolean) => void;
};

const DropdownMenuContext = createContext<DropdownMenuContextValue | null>(null);

function useDropdownMenuContext() {
  const context = useContext(DropdownMenuContext);
  if (!context) {
    throw new Error("DropdownMenu components must be rendered inside DropdownMenu");
  }
  return context;
}

export function DropdownMenu({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const contentId = useId();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <DropdownMenuContext.Provider value={{ contentId, open, setOpen }}>
      <div ref={ref} className="relative inline-flex">
        {children}
      </div>
    </DropdownMenuContext.Provider>
  );
}

export function DropdownMenuTrigger({
  className,
  onClick,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  const { contentId, open, setOpen } = useDropdownMenuContext();
  return (
    <button
      {...props}
      aria-controls={contentId}
      aria-expanded={open}
      className={className}
      type={type}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) setOpen(!open);
      }}
    />
  );
}

export function DropdownMenuContent({
  align = "start",
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { align?: "start" | "end" }) {
  const { contentId, open } = useDropdownMenuContext();
  if (!open) return null;
  return (
    <div
      {...props}
      id={contentId}
      role="menu"
      className={cn(
        "absolute top-full z-50 mt-1 rounded-md border border-[var(--sidebar-border)] bg-[var(--card)] p-1 text-sm shadow-lg",
        align === "end" ? "right-0" : "left-0",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function DropdownMenuItem({
  className,
  onClick,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  const { setOpen } = useDropdownMenuContext();
  return (
    <button
      {...props}
      role="menuitem"
      type={type}
      className={cn(
        "block w-full rounded px-2 py-1.5 text-left text-[var(--foreground)] hover:bg-[var(--accent-light)]",
        className,
      )}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) setOpen(false);
      }}
    />
  );
}
