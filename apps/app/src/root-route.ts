import { isEducationPathname } from "./education-access";
import { isEducationHubPathname } from "./education-routes";

export type RootRoute = "password" | "education" | "login" | "terms" | "pathology" | "dicom" | "reader";

/** Which top-level app a pathname renders. Only "reader" needs a wiki session or database. */
export function rootRouteFor(pathname: string, educationOnly: boolean): RootRoute {
  if (educationOnly && !isEducationPathname(pathname) && !isEducationHubPathname(pathname) &&
    !["/search", "/login", "/terms-and-conditions"].includes(pathname)) return "password";
  if (isEducationHubPathname(pathname)) return "education";
  if (pathname === "/login") return "login";
  if (pathname === "/terms-and-conditions") return "terms";
  if (pathname === "/tools/pathology-viewer") return "pathology";
  if (pathname === "/tools/dicom-viewer" || pathname === "/tools/dicom-compare") return "dicom";
  return "reader";
}
