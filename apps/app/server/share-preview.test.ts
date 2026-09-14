import { describe, expect, test } from "bun:test";
import { getFunctionName, type FunctionReference } from "convex/server";
import { handleSharePreviewRequest } from "./wiki-api";

function clientFor(siteSlug: string) {
  return {
    async query(ref: FunctionReference<"query">, args: Record<string, unknown>) {
      expect(args.includeSensitive).not.toBe(true);
      if (getFunctionName(ref) === "sites:getBySlug") {
        expect(args.slug).toBe(siteSlug);
        return { name: "Research Wiki", config: { title: "Research Wiki", description: "General research notes" } };
      }
      expect(getFunctionName(ref)).toBe("documents:getBySlug");
      expect(args.siteSlug).toBe(siteSlug);
      const pages = [
        { slug: "wiki/linked page", title: `${siteSlug} linked page`, description: 'Page-specific description & "details".' },
        { slug: "wiki/folder/index", title: "Folder overview", description: "Pages in this folder." },
        { slug: "wiki/no-description", title: "Page without a description", description: null },
      ];
      return pages.find((page) => page.slug === args.slug) ?? null;
    },
  };
}

async function preview(site: string, path: string) {
  const url = new URL("https://wiki.example/api/share-preview");
  url.searchParams.set("path", path);
  const response = await handleSharePreviewRequest(new Request(url), clientFor(site) as never, site);
  expect(response.status).toBe(200);
  return response.text();
}

describe("linked page card metadata", () => {
  for (const site of ["diana", "research"]) {
    test(`uses the linked page title and description for ${site}`, async () => {
      const html = await preview(site, "/wiki/linked%20page");
      expect(html).toContain(`property="og:title" content="${site} linked page"`);
      expect(html).toContain('property="og:description" content="Page-specific description &amp; &quot;details&quot;."');
      expect(html).toContain(`name="twitter:title" content="${site} linked page"`);
      expect(html).toContain('name="twitter:description" content="Page-specific description &amp; &quot;details&quot;."');
    });

    test(`uses directory index metadata for ${site}`, async () => {
      for (const path of ["/wiki/folder", "/wiki/folder/", "/wiki/folder/index.md"]) {
        const html = await preview(site, path);
        expect(html).toContain('property="og:title" content="Folder overview"');
        expect(html).toContain('property="og:description" content="Pages in this folder."');
      }
    });
  }

  test("keeps markdown aliases, query parameters and fragments out of page lookup", async () => {
    const html = await preview("diana", "/wiki/linked%20page.mdx?ref=share#details");
    expect(html).toContain('property="og:title" content="diana linked page"');
  });

  test("uses the page title when no description is available", async () => {
    const html = await preview("research", "/wiki/no-description");
    expect(html).toContain('property="og:description" content="Page without a description notes in Research Wiki"');
    expect(html).not.toContain("TNBC Knowledge Base");
  });

  test("uses site defaults for missing or non-public pages", async () => {
    const html = await preview("research", "/private/note");
    expect(html).toContain('property="og:title" content="Research Wiki"');
    expect(html).toContain('property="og:description" content="General research notes"');
  });
});
