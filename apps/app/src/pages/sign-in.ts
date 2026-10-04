import { safeLocalRedirect } from "../safe-redirect";

/** The sign-in page, continuing to `path` once the password is accepted. */
export function signInHref(path: string) {
  return `/sign-in?redirect=${encodeURIComponent(path)}`;
}

/** A gate redirect to a particular page goes straight to the password. */
export function asksForSignIn(search: string) {
  const redirect = new URLSearchParams(search).get("redirect");
  return redirect !== null && redirect !== "/";
}

/** Where to go after sign-in, keeping a deep link's own fragment. */
export function signInRedirectTarget({
  search,
  hash,
}: {
  search: string;
  hash: string;
}) {
  const target = safeLocalRedirect(
    new URLSearchParams(search).get("redirect"),
    "",
  );
  if (!target) return "/";
  // Browsers carry a deep link's fragment through the server redirect.
  return hash && !target.includes("#") ? `${target}${hash}` : target;
}
