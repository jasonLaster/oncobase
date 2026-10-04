import { safeLocalRedirect } from "../safe-redirect";

/** Fired when a landing-page link to a private page asks the visitor to sign in. */
export const SIGN_IN_DESTINATION_EVENT = "landing:sign-in-destination";

// The landing page's own anchors are never part of a deep link's destination.
const LANDING_SECTION_HASHES = new Set([
  "#landing-main",
  "#story",
  "#inside",
  "#privacy",
  "#education",
  "#platform",
  "#sign-in",
]);

export function signInHref(path: string) {
  return `/login?redirect=${encodeURIComponent(path)}#sign-in`;
}

/**
 * Private pages redirect signed-out visitors back to /login, so a plain link
 * would reopen this page. Record the destination and move to the password.
 */
export function requestSignIn(path: string, label: string) {
  window.history.replaceState(window.history.state, "", signInHref(path));
  window.dispatchEvent(
    new CustomEvent(SIGN_IN_DESTINATION_EVENT, { detail: { label } }),
  );
  const reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  document
    .getElementById("sign-in")
    ?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" });
  document
    .querySelector<HTMLInputElement>('#sign-in input[type="password"]')
    ?.focus({ preventScroll: true });
}

/**
 * Read the destination when the form is submitted, because a private-page
 * link may have chosen one after the page loaded.
 */
export function signInRedirectTarget(initial: {
  redirect: string | null;
  hash: string;
}) {
  const redirect = new URL(window.location.href).searchParams.get("redirect");
  const target = safeLocalRedirect(redirect, "");
  if (!target) return "/";
  // Browsers carry a deep link's fragment through the server redirect.
  const hash =
    redirect === initial.redirect && !LANDING_SECTION_HASHES.has(initial.hash)
      ? initial.hash
      : "";
  return hash && !target.includes("#") ? `${target}${hash}` : target;
}
