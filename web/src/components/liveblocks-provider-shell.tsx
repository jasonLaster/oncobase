"use client";

import { useEffect, useState, type ReactNode } from "react";
import { LiveblocksProvider } from "@liveblocks/react/suspense";
import {
  createGuestUser,
  LIVEBLOCKS_GUEST_COOKIE,
  LIVEBLOCKS_GUEST_STORAGE_KEY,
  parseGuestUser,
  serializeGuestUser,
} from "@/lib/guest-user";

const FALLBACK_PUBLIC_API_KEY =
  "pk_dev_HXZfdhC5pUVp1uUoX4mp31GEwMiYRKXXF5uoiZugexxsNV65JmHUqcRN__UFGQ05";

type SessionUser = {
  email: string;
  name: string | null;
};

type Identity = {
  name: string;
  email?: string;
};

export function LiveblocksProviderShell({ children }: { children: ReactNode }) {
  const publicApiKey =
    process.env.NEXT_PUBLIC_LIVEBLOCKS_PUBLIC_KEY ?? FALLBACK_PUBLIC_API_KEY;
  const [providerMode, setProviderMode] = useState<"auth" | "public">(
    "public"
  );
  const [identity, setIdentity] = useState<Identity | null>(null);

  useEffect(() => {
    const cookieValue = document.cookie
      .split(/;\s*/)
      .find((part) => part.startsWith(`${LIVEBLOCKS_GUEST_COOKIE}=`))
      ?.slice(LIVEBLOCKS_GUEST_COOKIE.length + 1);
    const cookieGuest = parseGuestUser(cookieValue);

    const storageValue = window.localStorage.getItem(LIVEBLOCKS_GUEST_STORAGE_KEY);
    const storageGuest = parseGuestUser(storageValue);

    const guest = cookieGuest ?? storageGuest ?? createGuestUser();
    const serialized = serializeGuestUser(guest);

    window.localStorage.setItem(LIVEBLOCKS_GUEST_STORAGE_KEY, serialized);
    document.cookie = `${LIVEBLOCKS_GUEST_COOKIE}=${serialized}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    let cancelled = false;

    async function resolveProvider() {
      try {
        const [authConfigResponse, sessionResponse] = await Promise.all([
          fetch("/api/liveblocks-auth"),
          fetch("/api/auth/session"),
        ]);

        const authConfig = authConfigResponse.ok
          ? ((await authConfigResponse.json()) as { configured?: boolean })
          : { configured: false };
        const sessionData = sessionResponse.ok
          ? ((await sessionResponse.json()) as { user?: SessionUser | null })
          : { user: null };

        if (cancelled) return;

        const sessionUser = sessionData.user;
        setIdentity(
          sessionUser
            ? {
                name: sessionUser.name || sessionUser.email,
                email: sessionUser.email,
              }
            : {
                name: guest.name,
              }
        );
        setProviderMode(authConfig.configured ? "auth" : "public");
      } catch {
        if (cancelled) return;
        setIdentity({ name: guest.name });
        setProviderMode("public");
      }
    }

    resolveProvider();

    // Persist guest name to Convex so the server can resolve it later
    fetch("/api/liveblocks-guest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guestId: guest.id, name: guest.name }),
    }).catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <LiveblocksProvider
      key={`${providerMode}:${identity?.email ?? identity?.name ?? "anonymous"}`}
      {...(providerMode === "auth"
        ? { authEndpoint: "/api/liveblocks-auth" }
        : { publicApiKey })}
      resolveUsers={async ({ userIds }) => {
        // For auth mode, Liveblocks stores userInfo from the token alongside
        // comments.  resolveUsers is only called as a fallback for user IDs
        // that were never seen through an auth token (e.g. old comments
        // created before auth was enabled).  Return the current user's
        // identity when we recognise our own ID; otherwise return an empty
        // object so Liveblocks falls back to whatever it already has stored.
        if (!identity) return userIds.map(() => ({}));
        return userIds.map(() => ({
          name: identity.name,
          ...(identity.email ? { email: identity.email } : {}),
        }));
      }}
    >
      {children}
    </LiveblocksProvider>
  );
}
