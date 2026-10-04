import type { WikiScope, WikiSessionIdentity } from "@oncobase/wiki-content";
import { useEffect } from "react";
import { safeLocalStorage } from "../safe-storage";
import { retireRequestedSessionReaderStores } from "./cache-retirement";

export function SessionCacheRetirement({
  identity,
  scope,
}: {
  identity: WikiSessionIdentity;
  scope: WikiScope;
}) {
  useEffect(() => {
    if (scope !== "public") return;
    retireRequestedSessionReaderStores({
      localStorage: safeLocalStorage,
      origin: window.location.origin,
      siteSlug: identity.siteSlug,
    }).catch(() => {
      // Retirement is best-effort; a later public visit retries it.
    });
  }, [identity.siteSlug, scope]);

  return null;
}
