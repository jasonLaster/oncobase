import { isOncobaseHost } from "../src/site-host";

/** Preview aliases that should serve the marketing site, from ONCOBASE_SITE_HOSTS (comma separated). */
function extraHosts() {
  return (process.env.ONCOBASE_SITE_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}

export function requestHost(request: Request) {
  return request.headers.get("host") ?? new URL(request.url).host;
}

/** Whether this request is for oncobase.io, the marketing site, which has no wiki and no API. */
export function isMarketingRequest(request: Request) {
  return isOncobaseHost(requestHost(request), extraHosts());
}
