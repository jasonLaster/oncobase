import { expect, test } from "@playwright/test";
import { anonymousContext, gateCookie, pinnedSite, requireLocalStack, runsAgainstPreview } from "./helpers";

// Host -> site resolution. Replaces the header-injection and unknown-site
// invariants of multi-site-isolation and the host tests of backend-api.
requireLocalStack();
test.skip(runsAgainstPreview, "Vercel previews do not accept synthetic Host headers.");

test("the Host header picks the site and injected site headers are overwritten", async ({ baseURL }) => {
  const context = await anonymousContext(baseURL!, { Host: "diana.localhost", "x-site-slug": "friend", "x-wiki-site": "friend" });
  try {
    const response = await context.get("/api/wiki/session");
    expect(response.ok(), await response.text()).toBeTruthy();
    expect(response.headers().vary).toContain("Host");
    const body = await response.json();
    expect(body.siteSlug).toBe("diana");
    expect(body.cacheKey).toContain("diana:public");
  } finally {
    await context.dispose();
  }
});

test("an unknown host fails closed on every read API, even with a valid gate cookie", async ({ baseURL }) => {
  test.skip(pinnedSite, "WIKI_SITE_SLUG pins every Host to one site; run against a multi-site server (unset it) to observe resolution.");
  const cookie = await gateCookie(baseURL!);
  const failures: string[] = [];
  for (const host of ["unknown-contract-site.invalid", "unknownsite.localhost"]) {
    const context = await anonymousContext(baseURL!, { Host: host, Cookie: cookie });
    try {
      for (const path of [
        "/api/wiki/session",
        "/api/wiki/manifest",
        "/api/search?q=diagnosis",
        "/api/wiki/pages?slugs=wiki/logistics/insurance",
        "/api/page-copy?slug=wiki/logistics/insurance",
        "/api/download?type=markdown",
        "/api/file?path=wiki/logistics/insurance-card.pdf",
      ]) {
        const response = await context.get(path);
        const body = (await response.body()).toString("latin1");
        // Closed: any refusal. Or an empty answer that names a different site and holds none of ours.
        const refused = response.status() >= 400;
        const empty = response.ok() && !/siteSlug":"diana"|Insurance paperwork|PDF-1\.4/.test(body) && !/"slug":"wiki\//.test(body);
        if (!refused && !empty) failures.push(`${host} ${path}: ${response.status()} ${body.slice(0, 80)}`);
      }
    } finally {
      await context.dispose();
    }
  }
  expect(failures).toEqual([]);
});
