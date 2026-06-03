"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
  type RefObject,
} from "react";
import { cn } from "@oncobase/wiki-shell";

// A tiny, dependency-free dropdown menu. It replaces the app-local Base UI
// dropdown so the comments package has no `apps/web` imports and can be
// consumed by both the Next.js and the Vite readers.

type DropdownContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  rootRef: RefObject<HTMLDivElement | null>;
};

const DropdownContext = createContext<DropdownContextValue | null>(null);

function useDropdownContext() {
  const ctx = useContext(DropdownContext);
  if (!ctx) {
    throw new Error("Dropdown components must be used within <DropdownMenu>");
  }
  return ctx;
}

export function DropdownMenu({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <DropdownContext.Provider value={{ open, rootRef, setOpen }}>
      <div className="wiki-comments-dropdown" ref={rootRef} style={{ position: "relative" }}>
        {children}
      </div>
    </DropdownContext.Provider>
  );
}

export function DropdownMenuTrigger({
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  const { open, setOpen } = useDropdownContext();
  return (
    <button
      aria-expanded={open}
      aria-haspopup="menu"
      onClick={() => setOpen(!open)}
      type="button"
      {...props}
    >
      {children}
    </button>
  );
}

export function DropdownMenuContent({
  align = "start",
  className,
  children,
}: {
  align?: "start" | "end";
  className?: string;
  children: ReactNode;
}) {
  const { open } = useDropdownContext();
  if (!open) return null;
  return (
    <div
      className={cn("wiki-comments-dropdown-content", className)}
      role="menu"
      style={{
        position: "absolute",
        top: "100%",
        [align === "end" ? "right" : "left"]: 0,
        zIndex: 50,
      }}
    >
      {children}
    </div>
  );
}

export function DropdownMenuItem({
  className,
  onClick,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  const { setOpen } = useDropdownContext();
  return (
    <button
      className={cn("wiki-comments-dropdown-item", className)}
      onClick={(event) => {
        onClick?.(event);
        setOpen(false);
      }}
      role="menuitem"
      type="button"
      {...props}
    >
      {children}
    </button>
  );
}
