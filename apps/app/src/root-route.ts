import { isEducationPathname } from "./education-access";
import { isEducationHubPathname } from "./education-routes";
import type { SiteKind } from "./site-host";

/** `X-Wiki-Reader-Access` when the server answers "/" with the landing page. */
export const LANDING_READER_ACCESS = "landing";

/** The server showed this signed-out visitor the landing page at "/". */
export function landingResponse(): boolean {
  return document.querySelector<HTMLMetaElement>('meta[name="wiki-reader-access"]')?.content === LANDING_READER_ACCESS;
}

export type RootRoute =
  | "password"
  | "education"
  | "login"
  | "sign-in"
  | "oncobase-home"
  | "features"
  | "compare"
  | "not-found"
  | "terms"
  | "pathology"
  | "dicom"
  | "reader";

/** The marketing site (oncobase.io) has three pages and no reader, wiki, or sign-in. */
export function marketingRouteFor(pathname: string): RootRoute {
  if (pathname === "/") return "oncobase-home";
  if (pathname === "/features") return "features";
  if (pathname === "/compare") return "compare";
  return "not-found";
}

/** Which top-level app a pathname renders. Only "reader" needs a wiki session or database. */
export function rootRouteFor(
  pathname: string,
  educationOnly: boolean,
  landing = false,
  site: SiteKind = "diana",
): RootRoute {
  if (site === "oncobase") return marketingRouteFor(pathname);
  if (landing && pathname === "/") return "login";
  if (educationOnly && !isEducationPathname(pathname) && !isEducationHubPathname(pathname) &&
    !["/search", "/login", "/sign-in", "/terms-and-conditions"].includes(pathname)) return "password";
  if (isEducationHubPathname(pathname)) return "education";
  if (pathname === "/login") return "login";
  if (pathname === "/sign-in") return "sign-in";
  if (pathname === "/terms-and-conditions") return "terms";
  if (pathname === "/tools/pathology-viewer") return "pathology";
  if (pathname === "/tools/dicom-viewer" || pathname === "/tools/dicom-compare") return "dicom";
  return "reader";
}

/** Which site the server answered with: it marks marketing responses, and the dev server mirrors that. */
export function siteResponse(): SiteKind {
  return document.querySelector<HTMLMetaElement>('meta[name="wiki-site"]')?.content === "oncobase" ? "oncobase" : "diana";
}
