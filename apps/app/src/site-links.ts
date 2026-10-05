import { siteOrigin, type SiteKind } from "./site-host";

/** Where a page of the other site lives, from the visitor's current location. */
export function siteUrl(site: SiteKind, path = "/"): string {
  const here = typeof window === "undefined" ? null : window.location;
  return `${siteOrigin(site, here)}${path}`;
}

export const oncobaseUrl = (path = "/") => siteUrl("oncobase", path);
export const dianaUrl = (path = "/") => siteUrl("diana", path);
