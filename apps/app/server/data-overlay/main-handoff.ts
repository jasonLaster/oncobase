// GET diana-tnbc.com/api/data-overlay/handoff?next=<data path>&state=<state>
//
// The diana-tnbc.com half of the data-host sign-in. With an account session
// it redirects to the configured data origin's /_auth/callback with a
// 60-second signed token; without one it sends the visitor to /sign-in and
// back here. The destination origin always comes from configuration, never
// from the request.

import type { ConvexHttpClient } from "convex/browser";
import { getSessionUser } from "../reader-access";
import { dataOverlayConfigFromEnv, type DataOverlayConfig } from "./config";
import { isHandoffState, mintHandoffToken, MIN_HANDOFF_SECRET_LENGTH } from "./handoff";
import { MAIN_HANDOFF_PATH, PRIVATE_HEADERS } from "./handler";
import { safeDataNext } from "./paths";

type HandoffDeps = {
  config?: DataOverlayConfig;
  getUser?: (request: Request, client: ConvexHttpClient, siteSlug: string) => Promise<{ _id: string } | null>;
  now?: () => number;
};

const plain = (status: number, body: string) =>
  new Response(body, { status, headers: { ...PRIVATE_HEADERS, Vary: "Cookie, Host", "Content-Type": "text/plain; charset=utf-8" } });

export async function handleDataOverlayHandoff(
  request: Request,
  client: ConvexHttpClient,
  siteSlug: string,
  { config = dataOverlayConfigFromEnv(), getUser = getSessionUser, now = Date.now }: HandoffDeps = {},
) {
  if (request.method !== "GET") {
    return new Response(null, { status: 405, headers: { ...PRIVATE_HEADERS, Allow: "GET" } });
  }
  // Only the site whose accounts the data host trusts may vouch for a user.
  if (siteSlug !== config.siteSlug) return plain(404, "Not found");
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  if (!isHandoffState(state)) return plain(400, "Bad request");
  const next = safeDataNext(url.searchParams.get("next"));
  if (!config.handoffSecret || config.handoffSecret.length < MIN_HANDOFF_SECRET_LENGTH) {
    return plain(503, "Data sign-in is not configured");
  }

  const user = await getUser(request, client, siteSlug);
  const headers = { ...PRIVATE_HEADERS, Vary: "Cookie, Host" };
  if (!user) {
    const here = `${MAIN_HANDOFF_PATH}?${new URLSearchParams({ next, state })}`;
    return new Response(null, { status: 302, headers: { ...headers, Location: `/sign-in?redirect=${encodeURIComponent(here)}` } });
  }

  const token = mintHandoffToken({ sub: user._id, site: config.siteSlug, aud: config.dataOrigin, state }, config.handoffSecret, now());
  const callback = new URL("/_auth/callback", config.dataOrigin);
  callback.searchParams.set("token", token);
  callback.searchParams.set("next", next);
  return new Response(null, { status: 302, headers: { ...headers, Location: callback.toString() } });
}
