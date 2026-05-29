"use client";

import { useEffect, useState, type ReactNode } from "react";
import { LiveblocksProvider } from "@liveblocks/react/suspense";
import {
  createGuestUser,
  LIVEBLOCKS_GUEST_COOKIE,
  LIVEBLOCKS_GUEST_STORAGE_KEY,
  parseGuestUser,
  serializeGuestUser,
} from "../../../apps/web/src/lib/guest-user";
import { formatLiveblocksUserId } from "./user-format";

const FALLBACK_PUBLIC_API_KEY =
  "pk_dev_HXZfdhC5pUVp1uUoX4mp31GEwMiYRKXXF5uoiZugexxsNV65JmHUqcRN__UFGQ05";

type SessionUser = {
  _id?: string;
  email: string;
  name: string | null;
};

type Identity = {
  id?: string;
  name: string;
  email?: string;
};

type ResolvedUsersResponse = {
  users?: Record<string, { name?: string; email?: string }>;
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
                id: sessionUser._id,
                name: sessionUser.name || sessionUser.email,
                email: sessionUser.email,
              }
            : {
                id: guest.id,
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
        try {
          const response = await fetch("/api/liveblocks-users", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userIds }),
          });

          if (response.ok) {
            const data = (await response.json()) as ResolvedUsersResponse;
            return userIds.map((userId) => {
              const user = data.users?.[userId];
              return {
                name: user?.name ?? formatLiveblocksUserId(userId),
                ...(user?.email ? { email: user.email } : {}),
              };
            });
          }
        } catch {
          // Fall back below so author labels remain stable offline.
        }

        return userIds.map((userId) => {
          if (identity?.id === userId && identity.name) {
            return {
              name: identity.name,
              ...(identity.email ? { email: identity.email } : {}),
            };
          }

          return { name: formatLiveblocksUserId(userId) };
        });
      }}
    >
      {children}
    </LiveblocksProvider>
  );
}
