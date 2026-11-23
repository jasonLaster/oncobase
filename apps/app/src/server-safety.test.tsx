// SSR stage 0 (plans/2026-11-17-server-rendering-plan.md §2.1): the reader's
// first frame must render with no DOM. These tests run under Bun without
// `window` or `document`, as a server render does.
import { DocumentOutlineShell, ResizableLayout, WikiMobileNavigationSheet, WikiSidebar, type WikiNavigationNode } from "@oncobase/wiki-shell";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { prerender } from "react-dom/static";
import { MemoryRouter } from "react-router";
import { injectNavigationBootstrap, injectPageBootstrap, navigationSlice } from "../server/page-bootstrap";
import { renderReaderFirstFrame } from "./server-entry";
import { HeaderAuthDialogHost, startupSignInRequested, WikiAuthProvider } from "./shell/Header";
import { useBrowserOnline } from "./shell/ReaderStatus";
import { signInHrefFor } from "./wiki-utils";

test("there is no DOM here", () => {
  expect(typeof window).toBe("undefined");
  expect(typeof document).toBe("undefined");
});

describe("useBrowserOnline", () => {
  function Probe() { return <span>{useBrowserOnline() ? "online" : "offline"}</span>; }
  test("renders on the server, as online (it used to throw: no getServerSnapshot)", () => {
    expect(renderToStaticMarkup(<Probe />)).toBe("<span>online</span>");
  });
});

describe("account state and the sign-in dialog", () => {
  test("render on the server, with the dialog closed", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/wiki/a?reader-action=signin"]}>
        <WikiAuthProvider><HeaderAuthDialogHost /></WikiAuthProvider>
      </MemoryRouter>,
    );
    expect(html).not.toContain('role="dialog"');
  });

  test("a sign-in queued before the reader mounted opens it", () => {
    expect(startupSignInRequested("signin", "")).toBe(true);
    expect(startupSignInRequested(null, "?reader-action=signin")).toBe(true);
    expect(startupSignInRequested("pages", "?reader-action=other")).toBe(false);
    expect(startupSignInRequested(undefined, "")).toBe(false);
  });
});

describe("signInHrefFor", () => {
  test("returns to the route without an explicit scope, from the path alone", () => {
    expect(signInHrefFor({ pathname: "/wiki/a", search: "?scope=session&x=1", hash: "#h" }))
      .toBe(`/sign-in?redirect=${encodeURIComponent("/wiki/a?x=1#h")}`);
    expect(signInHrefFor({ pathname: "/wiki/a", search: "", hash: "" })).toBe(`/sign-in?redirect=${encodeURIComponent("/wiki/a")}`);
  });
});

// The shell's UI SDK parts (Tree, Resizable, Drawer, Segmented Control,
// Tooltip) through the renderer server-entry.tsx uses.
describe("the reader shell's UI SDK parts", () => {
  async function prerenderToString(node: React.ReactNode) {
    const errors: unknown[] = [];
    const { prelude } = await prerender(node, { onError: (error) => void errors.push(error) });
    const html = await new Response(prelude).text();
    expect(errors).toEqual([]);
    return html;
  }

  const file = (slug: string): WikiNavigationNode => ({ name: slug.split("/").at(-1)!, slug, type: "file" });
  const tree: WikiNavigationNode[] = [
    file("index"),
    { name: "wiki", slug: "wiki", type: "directory", children: [
      { name: "treatment", slug: "wiki/treatment", type: "directory", children: [file("wiki/treatment/note")] },
      { name: "closed", slug: "wiki/closed", type: "directory", children: [file("wiki/closed/a")] },
    ] },
  ];

  test("the sidebar tree, the resizable layout and a closed sheet render without throwing", async () => {
    const html = await prerenderToString(
      <ResizableLayout
        sidebar={(
          <WikiSidebar
            activeSlug="wiki/treatment/note"
            expandedSlugs={["wiki", "wiki/treatment"]}
            onToggleDirectory={() => {}}
            renderPageLink={({ children, className, node, style }) => <a className={className} href={`/${node.slug}`} style={style}>{children}</a>}
            tree={tree}
          />
        )}
      >
        <WikiMobileNavigationSheet open={false} onOpenChange={() => {}} title="Note">
          <nav />
        </WikiMobileNavigationSheet>
      </ResizableLayout>,
    );
    expect(html).toMatch(/aria-label="Pages"[^>]*role="tree"/);
    // Open branches carry aria-expanded from the first HTML; a closed one hides its rows.
    expect(html.match(/aria-expanded="true"/g)).toHaveLength(2);
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('href="/wiki/closed/a"');
    // The current page takes the tree's one tab stop.
    expect(html).toMatch(/tabindex="0"[^>]*aria-current="page"/);
    expect(html.match(/role="treeitem"[^>]*tabindex="0"|tabindex="0"[^>]*role="treeitem"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-label="Resize sidebar"[^>]*role="separator"/);
    expect(html).toContain('data-test-id="bottom-nav-trigger"');
    expect(html).not.toContain('data-test-id="bottom-nav-sheet"');
  });

  test("an open outline pane renders its resizable group and rail switch", async () => {
    const html = await prerenderToString(
      <DocumentOutlineShell contentKey="k" defaultOpen onActivateComments={() => {}}>
        <h2 id="a">A</h2>
      </DocumentOutlineShell>,
    );
    expect(html).toMatch(/aria-label="Resize outline pane"[^>]*role="separator"/);
    expect(html).toMatch(/role="radiogroup"[^>]*aria-label="Rail view"|aria-label="Rail view"[^>]*role="radiogroup"/);
    expect(html).toMatch(/role="radio"[^>]*aria-checked="true"[^>]*>Outline</);
  });

  test("the reader's first frame includes them, with the mobile header named from its tooltips", async () => {
    const url = new URL("https://example.test/wiki/treatment/note");
    const page = { slug: "wiki/treatment/note", title: "Treatment note", content: "# Treatment note\n\nBody.", contentHash: "h", sensitive: false };
    const payload = injectNavigationBootstrap(
      injectPageBootstrap("</body>", page, url, "example", { publicSessionVerified: true }),
      navigationSlice(["wiki/treatment/note", "wiki/biomarkers/a"], page.slug), url, "example", { scope: "public" },
    );
    const html = await renderReaderFirstFrame({ url, payloadHtml: payload, env: { VITE_WIKI_SITE_SLUG: "example" }, now: 2_000_000, timeoutMs: 5_000 });
    expect(html).not.toBeNull();
    expect(html).toContain('role="tree"');
    expect(html).toMatch(/aria-label="Resize sidebar"[^>]*role="separator"/);
    const trigger = html!.match(/<button[^>]*data-test-id="bottom-nav-trigger"[^>]*>/)?.[0] ?? "";
    const labelId = trigger.match(/aria-labelledby="([^"]+)"/)?.[1];
    expect(labelId).toBeTruthy();
    expect(html).toContain(`id="${labelId}" hidden="" data-closed="">Open page navigation<`);
  });
});
