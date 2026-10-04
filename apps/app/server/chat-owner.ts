import { conversationOwnerKey } from "../convex/lib/conversationAuth";

/**
 * Per-viewer chat conversation ownership.
 *
 * Signed-in users own conversations by user id (so they follow the account
 * across devices). Everyone else (password-gate-only or ungated viewers) owns
 * them through a random 128-bit httpOnly cookie. Only a site-scoped sha256 of
 * either principal is sent to Convex — in the browser JWT `ownerKey` claim and
 * as the explicit `ownerKey` argument of server-side conversation writes.
 */
export const CHAT_OWNER_COOKIE = "wiki-chat-owner";
const CHAT_OWNER_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
const COOKIE_VALUE_RE = /^[A-Za-z0-9_-]{22}$/;

function randomCookieValue() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function chatOwnerCookieFromHeader(cookieHeader: string) {
  const value = cookieHeader
    .split(/;\s*/)
    .find((part) => part.startsWith(`${CHAT_OWNER_COOKIE}=`))
    ?.slice(CHAT_OWNER_COOKIE.length + 1);
  return value && COOKIE_VALUE_RE.test(value) ? value : undefined;
}

function chatOwnerCookie(request: Request, value: string) {
  const secure = process.env.NODE_ENV === "production" || new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${CHAT_OWNER_COOKIE}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${CHAT_OWNER_COOKIE_MAX_AGE}${secure}`;
}

export type ChatOwner = { ownerKey: string; setCookie?: string };

/**
 * Resolve the caller's owner key. With `issue`, a missing anonymous cookie is
 * minted and returned as `setCookie`. Without it, a caller that has no owner
 * gets a throwaway key that matches no stored conversation — never "no key",
 * which Convex treats as a legacy unrestricted server call.
 */
export function resolveChatOwner(
  request: Request,
  siteSlug: string,
  sessionUser: { _id: string } | null,
  { issue = false }: { issue?: boolean } = {},
): ChatOwner {
  if (sessionUser) return { ownerKey: conversationOwnerKey(siteSlug, `user:${sessionUser._id}`) };
  const existing = chatOwnerCookieFromHeader(request.headers.get("cookie") ?? "");
  if (existing) return { ownerKey: conversationOwnerKey(siteSlug, `anon:${existing}`) };
  const minted = randomCookieValue();
  const ownerKey = conversationOwnerKey(siteSlug, `${issue ? "anon" : "unowned"}:${minted}`);
  return issue ? { ownerKey, setCookie: chatOwnerCookie(request, minted) } : { ownerKey };
}
