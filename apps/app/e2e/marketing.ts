import { test } from "@playwright/test";

// oncobase.io is the Oncobase marketing site; Diana's knowledge base is every other host. Locally the
// marketing site is oncobase.localhost on the dev server's port (browsers send *.localhost to loopback).
const base = new URL(process.env.PLAYWRIGHT_BASE_URL || `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT || "61001"}`);
export const isLocalBase = /^(localhost|127\.0\.0\.1)$/.test(base.hostname);
export const dianaBaseURL = base.origin;
export const marketingBaseURL = isLocalBase
  ? `${base.protocol}//oncobase.localhost${base.port ? `:${base.port}` : ""}`
  : base.origin;

/** Call at the top of a spec file: its tests visit the marketing site. */
export function useMarketingSite() {
  test.use({ baseURL: marketingBaseURL });
  test.skip(!isLocalBase, "The marketing site is reached at oncobase.localhost; deployed runs would need an ONCOBASE_SITE_HOSTS alias.");
}
