// The SSR renderer against fixtures, under Bun with no DOM (as a server
// renders). Payloads come from the server's own page-bootstrap functions.
import { describe, expect, test } from "bun:test";
import { injectNavigationBootstrap, injectPageBootstrap, injectSessionPageBootstrap, navigationSlice } from "../server/page-bootstrap";
import { renderReaderFirstFrame } from "./server-entry";

const url = new URL("https://example.test/wiki/treatment/note");
const env = { VITE_WIKI_SITE_SLUG: "example" };
const now = 2_000_000;
const slugs = ["wiki/treatment/note", "wiki/treatment/other", "wiki/biomarkers/a", "sources/papers/p1"];
const shell = "</body>";

function publicPayload(content: string, slug = "wiki/treatment/note") {
  const page = { slug, title: "Treatment note", content, contentHash: "h", sensitive: false };
  return injectNavigationBootstrap(injectPageBootstrap(shell, page, url, "example", { publicSessionVerified: true }),
    navigationSlice(slugs, slug), url, "example", { scope: "public" });
}
const render = (payloadHtml: string, options: { timeoutMs?: number; at?: number; href?: URL } = {}) =>
  renderReaderFirstFrame({ url: options.href ?? url, payloadHtml, env, now: options.at ?? now, timeoutMs: options.timeoutMs ?? 5_000 });

function drugPanel(tables: number) {
  const out = ["# Drug panel", "", "Synthetic fixture shaped like a large screening review.", ""];
  for (let t = 0; t < tables; t++) {
    out.push(`## Panel ${t + 1}`, "", "Response across the panel.", "", "| Drug | Target | IC50 | Response |", "| --- | --- | ---: | --- |");
    for (let r = 0; r < 24; r++) out.push(`| drug-${t}-${r} | target-${r % 7} | ${(r * 3.1).toFixed(1)} | ${r % 2 ? "sensitive" : "resistant"} |`);
    out.push("");
  }
  return out.join("\n");
}

const normal = "# Treatment note\n\nThe plan for this cycle.\n\n## Schedule\n\n| Day | Drug |\n| --- | --- |\n| 1 | carboplatin |\n\nSee [the other note](/wiki/treatment/other).";

describe("public documents", () => {
  test("a normal page renders the chrome, the navigation slice and the article, with no client-render fallback", async () => {
    const html = await render(publicPayload(normal));
    expect(html).not.toBeNull();
    // No client-render fallback, and nothing outlined for a later reveal.
    expect(html).not.toMatch(/<!--\$[!?]-->|data-msg|data-dgst|\$RC\(/);
    expect(html).toContain("The plan for this cycle.");
    expect(html).toContain('data-test-id="sidebar-tree"');
    expect(html).toContain('href="/wiki/treatment/other"');
    expect(html).toContain('data-reader-identity-pending="true"');
  });

  test("the same inputs render the same bytes", async () => {
    expect(await render(publicPayload(normal))).toBe(await render(publicPayload(normal)));
  });

  test("math and raw HTML render their optional stages, not the loading fallback", async () => {
    const math = await render(publicPayload(`${normal}\n\nDose intensity is $RDI = \\frac{a}{b}$.`));
    expect(math).toContain('class="katex"');
    const raw = await render(publicPayload(`${normal}\n\n<details><summary>More</summary>Hidden</details>`));
    expect(raw).toContain("<summary>More</summary>");
  });

  test("named MDX and legacy slides render their first slide in the initial HTML", async () => {
    const content = `import { SlidesViewer } from "@oncobase/wiki-markdown"

# Slide fixture

<SlidesViewer images={[{"src":"images/first.png","alt":"First"},{"src":"images/second.png","alt":"Second"}]} />

<!-- slides -->

- ![First](images/first.png)
- ![Second](images/second.png)
`;
    const html = await render(publicPayload(content));
    const slideTags = html?.match(/<li\b[^>]*data-wiki-slide=""[^>]*>/g) ?? [];
    expect(slideTags.map(tag => tag.includes(' hidden=""'))).toEqual([false, true, false, true]);
    expect(html).not.toMatch(/<!--\$[!?]-->|\$RC\(/);
  });

  test("an 18-table page renders every table", async () => {
    const html = await render(publicPayload(drugPanel(18), "wiki/treatment/note"));
    expect(html?.match(/<table/g)?.length).toBe(18);
  });
});

describe("signed-in documents", () => {
  const identity = { siteSlug: "example", scope: "session" as const, authenticated: true, cacheVersion: "v1",
    cacheKey: "example:session:abc:v1", userHash: "abc" };
  const record = { slug: "wiki/treatment/note", title: "Care note", content: "# Care note\n\nFor the care team only.", contentHash: "h",
    sensitive: true, tags: [], size: 36 };
  const payload = injectNavigationBootstrap(injectSessionPageBootstrap(shell, identity, record, url, "example"),
    navigationSlice(slugs, record.slug), url, "example", { scope: "session", identity });

  test("render the session page with the document's own identity", async () => {
    const html = await render(payload);
    expect(html).toContain("For the care team only.");
    expect(html).toContain('data-reader-identity-pending="false"');
  });

  test("an explicit public scope never renders the session page", async () => {
    const href = new URL(url);
    href.search = "?scope=public";
    expect(await render(payload, { href })).toBeNull();
  });
});

describe("nothing to render", () => {
  test("no payload, or a sensitive public page (which carries none)", async () => {
    expect(await render(shell)).toBeNull();
    const sensitive = injectPageBootstrap(shell, { slug: "wiki/treatment/note", title: "T", content: "secret", contentHash: "h", sensitive: true }, url, "example");
    expect(sensitive).toBe(shell);
    expect(await render(sensitive)).toBeNull();
  });

  test("a render over its time budget gives up", async () => {
    expect(await render(publicPayload(drugPanel(18)), { timeoutMs: 1 })).toBeNull();
  });
});
