import { describe, expect, test } from "bun:test";
import { getFunctionName, type FunctionReference } from "convex/server";
import { handleSharePreviewRequest } from "./api/share-preview";
import { handleShareImageRequest } from "./api/share-image";
import { pageDescription } from "./page-social-metadata";

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
        { slug: "wiki/prose", title: "Immune recognition", content: '# Immune recognition\n\n![Cartoon](private.png)\n\nCancer cells can hide from **immune cells**. [T cells](t-cells) help recognize them.\n\n```ts\nignore this code\n```' },
        { slug: "wiki/education/immune-recognition", title: "Immune recognition", description: "How immune cells recognize cancer." },
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
      expect(html).toContain('name="twitter:card" content="summary_large_image"');
      expect(html).toContain('property="og:image" content="https://wiki.example/api/share-image?path=%2Fwiki%2Flinked%2520page"');
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

  test("uses published page prose when an authored description is absent", async () => {
    const html = await preview("diana", "/wiki/prose");
    expect(html).toContain('property="og:description" content="Cancer cells can hide from immune cells. T cells help recognize them."');
    expect(html).not.toContain("private.png");
    expect(html).not.toContain("ignore this code");
  });

  test("resolves public education URLs to their published lesson", async () => {
    const html = await preview("diana", "/education/immune-recognition");
    expect(html).toContain('property="og:title" content="Immune recognition"');
    expect(html).toContain('property="og:image" content="https://wiki.example/api/share-image?path=%2Feducation%2Fimmune-recognition"');
  });

  test("uses site defaults for missing or non-public pages", async () => {
    const html = await preview("research", "/private/note");
    expect(html).toContain('property="og:title" content="Research Wiki"');
    expect(html).toContain('property="og:description" content="General research notes"');
  });
});

describe("landing page card", () => {
  test("shows the landing card with an absolute image for Diana's bare domain", async () => {
    const html = await preview("diana", "/");
    expect(html).toContain("<title>Diana TNBC Knowledge Base</title>");
    expect(html).toContain('property="og:title" content="It takes a village"');
    expect(html).toContain("triple-negative breast cancer");
    expect(html).toContain('property="og:image" content="https://wiki.example/landing/og-image.jpg"');
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
    expect(html).toContain('name="twitter:image" content="https://wiki.example/landing/og-image.jpg"');
  });

  test("keeps page links and other sites separate from the landing card", async () => {
    for (const [site, path] of [["diana", "/wiki/linked%20page"], ["research", "/"]] as const) {
      const html = await preview(site, path);
      if (path === "/") expect(html).not.toContain("og:image");
      expect(html).not.toContain("It takes a village");
    }
  });
});

describe("page image", () => {
  test("renders different 1200 by 630 PNGs for different pages", async () => {
    const images = [];
    for (const path of ["/wiki/linked%20page", "/wiki/prose", "/education/immune-recognition"]) {
      const response = await handleShareImageRequest(new Request(`https://wiki.example/api/share-image?path=${encodeURIComponent(path)}`), clientFor("diana") as never, "diana");
      expect(response.headers.get("content-type")).toBe("image/png");
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      const image = Buffer.from(await response.arrayBuffer());
      expect(image.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
      expect(image.readUInt32BE(16)).toBe(1200);
      expect(image.readUInt32BE(20)).toBe(630);
      images.push(image);
    }
    expect(images[0]!.equals(images[1]!)).toBe(false);
  });

  test("missing pages have no image and methods are constrained", async () => {
    const url = "https://wiki.example/api/share-image?path=/missing";
    expect((await handleShareImageRequest(new Request(url), clientFor("diana") as never, "diana")).status).toBe(404);
    expect((await handleShareImageRequest(new Request(url, { method: "POST" }), clientFor("diana") as never, "diana")).status).toBe(405);
    const head = await handleShareImageRequest(new Request("https://wiki.example/api/share-image?path=/wiki/prose", { method: "HEAD" }), clientFor("diana") as never, "diana");
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  });
});

test("page summaries omit frontmatter, headings, tables, code and hidden HTML", () => {
  expect(pageDescription({ title: "Example", content: "---\nsecret: value\n---\n# Heading\n\n<!-- hidden -->\n<script>bad()</script>\n| Table |\n| --- |\n\nReadable [[wiki/page|page text]] and `terms`." }, "Wiki"))
    .toBe("Readable page text and terms.");
});
