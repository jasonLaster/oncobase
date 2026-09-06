import { useEffect } from "react";
import { useLocation } from "react-router";
import {
  updateClientRouteMetadata,
  WIKI_SITE_DESCRIPTION,
  WIKI_SITE_NAME,
} from "../document-title";
import { specialRouteMetadata } from "../special-route-metadata";

export function SpecialRouteMetadata() {
  const { pathname } = useLocation();

  useEffect(() => {
    const metadata = specialRouteMetadata({
      defaultDescription: WIKI_SITE_DESCRIPTION,
      pathname,
      siteName: WIKI_SITE_NAME,
    });
    if (metadata) updateClientRouteMetadata(metadata);
  }, [pathname]);

  return null;
}
