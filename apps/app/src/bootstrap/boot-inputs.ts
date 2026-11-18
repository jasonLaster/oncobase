import type { WikiSessionIdentity } from "@oncobase/wiki-content";
import { explicitReaderScope } from "../reader-session";
import { BOOTSTRAP_MAX_AGE_MS, NAVIGATION_BOOTSTRAP_ID, PAGE_BOOTSTRAP_ID, parseSessionPageBootstrap } from "./page-payload";
import { publicIdentityFromPageBootstrap } from "./public-identity";

/**
 * Everything the reader's first frame reads from its document and URL, as
 * one plain value (plans/2026-11-17-server-rendering-plan.md §3.1). The
 * derivations below are pure functions of it, so the server can compute the
 * same first frame from the payload it is about to write.
 *
 * The client still snapshots the live document wherever it read it before
 * (`readBootInputs()`): seeding removes the payload nodes, and a later read
 * must not see a page again after the store consumed it.
 */
export type ReaderBootInputs = {
  origin: string;
  pathname: string;
  search: string;
  /** `VITE_WIKI_API_ORIGIN` resolved against the origin. */
  apiOrigin: string;
  /** `VITE_WIKI_SITE_SLUG`, trimmed; undefined when unset. */
  configuredSiteSlug?: string;
  /** `<script id="wiki-page-bootstrap">`, with the receipt time the browser stamped. */
  page: { raw: string; receivedAt: number } | null;
  /** `<script id="wiki-navigation-bootstrap">`, likewise. */
  navigation: { raw: string; receivedAt: number } | null;
  now: number;
};

type Env = { VITE_WIKI_API_ORIGIN?: string; VITE_WIKI_SITE_SLUG?: string };

function dataBlock(node: { textContent: string | null; dataset: DOMStringMap } | null) {
  return node ? { raw: node.textContent ?? "", receivedAt: Number(node.dataset.receivedAt) } : null;
}

export function bootInputs(location: { origin: string; pathname: string; search: string }, env: Env,
  blocks: Pick<ReaderBootInputs, "page" | "navigation">, now = Date.now()): ReaderBootInputs {
  return {
    origin: location.origin, pathname: location.pathname, search: location.search,
    apiOrigin: new URL(env.VITE_WIKI_API_ORIGIN || location.origin, location.origin).origin,
    configuredSiteSlug: env.VITE_WIKI_SITE_SLUG?.trim() || undefined,
    ...blocks, now,
  };
}

/** The data blocks of served HTML, as the browser would read them, with the
 * receipt time its stamp script would record. For a server render and tests. */
export function bootBlocksFromHtml(html: string, receivedAt: number): Pick<ReaderBootInputs, "page" | "navigation"> {
  const block = (id: string) => {
    const raw = html.match(new RegExp(`<script id="${id}" type="application/json">([\\s\\S]*?)</script>`))?.[1];
    return raw === undefined ? null : { raw, receivedAt };
  };
  return { page: block(PAGE_BOOTSTRAP_ID), navigation: block(NAVIGATION_BOOTSTRAP_ID) };
}

/** The live document, now. */
export function readBootInputs(now = Date.now()): ReaderBootInputs {
  return bootInputs(location, import.meta.env as Env, {
    page: dataBlock(document.getElementById(PAGE_BOOTSTRAP_ID)),
    navigation: dataBlock(document.getElementById(NAVIGATION_BOOTSTRAP_ID)),
  }, now);
}

export const fresh = (block: { receivedAt: number } | null, now: number) => {
  const age = now - Number(block?.receivedAt);
  return Boolean(block) && Number.isFinite(age) && age >= 0 && age <= BOOTSTRAP_MAX_AGE_MS;
};

/** The session API's answer a signed-in document carried, if it may be used. */
export function documentSessionIdentity(inputs: ReaderBootInputs): WikiSessionIdentity | null {
  try {
    const search = new URLSearchParams(inputs.search);
    if (explicitReaderScope(inputs.search) === "public" || search.get("readerBootstrap") === "0") return null;
    if (!inputs.page || !fresh(inputs.page, inputs.now)) return null;
    const payload = parseSessionPageBootstrap(inputs.page.raw, { origin: inputs.origin, pathname: inputs.pathname, apiOrigin: inputs.apiOrigin });
    return payload && (!inputs.configuredSiteSlug || inputs.configuredSiteSlug === payload.siteSlug) ? payload.identity : null;
  } catch { return null; }
}

/** The public identity a fresh public payload implies (never selects a session). */
export function documentPublicIdentity(inputs: ReaderBootInputs, scope: string | null): WikiSessionIdentity | null {
  return inputs.page ? publicIdentityFromPageBootstrap(inputs.page.raw, inputs.page.receivedAt, {
    origin: inputs.origin, pathname: inputs.pathname, apiOrigin: inputs.apiOrigin,
    scope, configuredSiteSlug: inputs.configuredSiteSlug, now: inputs.now,
  }) : null;
}
