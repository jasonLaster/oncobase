import type { WikiScope, WikiSessionIdentity } from "@oncobase/wiki-content";
import { useEffect } from "react";
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
    void retireRequestedSessionReaderStores({
      localStorage: window.localStorage,
      origin: window.location.origin,
      siteSlug: identity.siteSlug,
    });
  }, [identity.siteSlug, scope]);

  return null;
}
