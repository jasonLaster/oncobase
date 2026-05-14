"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";

let intendedPathname: string | null = null;
let intentTimeout: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return intendedPathname;
}

function normalizePathname(pathname: string) {
  return decodeURIComponent(pathname);
}

export function setNavigationIntent(pathname: string) {
  intendedPathname = normalizePathname(pathname);
  if (intentTimeout) clearTimeout(intentTimeout);
  intentTimeout = setTimeout(() => {
    clearNavigationIntent();
  }, 10_000);
  emit();
}

function clearNavigationIntent() {
  if (!intendedPathname) return;
  intendedPathname = null;
  if (intentTimeout) {
    clearTimeout(intentTimeout);
    intentTimeout = null;
  }
  emit();
}

export function useNavigationPathname() {
  const routerPathname = normalizePathname(usePathname());
  const intent = useSyncExternalStore(subscribe, getSnapshot, () => null);
  const previousRouterPathnameRef = useRef(routerPathname);

  useEffect(() => {
    const previousRouterPathname = previousRouterPathnameRef.current;
    previousRouterPathnameRef.current = routerPathname;

    if (!intent) return;

    if (routerPathname !== previousRouterPathname || routerPathname === intent) {
      clearNavigationIntent();
    }
  }, [intent, routerPathname]);

  return intent ?? routerPathname;
}
