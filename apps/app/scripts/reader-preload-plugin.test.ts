import { expect, test } from "bun:test";
import { rootRouteFor } from "../src/root-route";
import { startsReader } from "./reader-preload-plugin";

// The inline head script cannot import the router, so it carries its own copy
// of the decision. A document that will not start the reader must not download
// it (the landing page used to fetch about 600 KB of reader JavaScript), and a
// reader document must not lose its preloads.
test("reader modules are preloaded exactly for documents that start the reader", () => {
  const paths = ["/", "/wiki/treatment/plan", "/sources/emails/2026-03/note", "/search", "/chat", "/admin", "/diagnostics", "/tags/treatment",
    "/login", "/sign-in", "/share", "/terms-and-conditions", "/tools/dicom-viewer", "/tools/dicom-compare", "/tools/pathology-viewer", "/tools/pdf-viewer",
    "/tools/medical-deduction", "/education", "/education/search", "/education/cells/index", "/wiki/education/cells", "/wiki/Education/cells"];
  const cases = [
    { access: "wiki", landing: false, educationOnly: false },
    { access: "landing", landing: true, educationOnly: false },
    { access: "education", landing: false, educationOnly: true },
    { access: "unknown", landing: false, educationOnly: false },
  ];
  for (const { access, landing, educationOnly } of cases) {
    for (const pathname of paths) {
      // The server only answers "landing" for "/".
      if (landing && pathname !== "/") continue;
      expect([access, pathname, startsReader("diana-tnbc.com", pathname, access, null)])
        .toEqual([access, pathname, rootRouteFor(pathname, educationOnly, landing, "diana") === "reader"]);
    }
  }
  for (const pathname of ["/", "/features", "/compare", "/anything"]) {
    expect(startsReader("oncobase.io", pathname, "public", null)).toBe(false);
    // A preview alias has an arbitrary host name; the server's stamp decides.
    expect(startsReader("oncobase-preview.vercel.app", pathname, "public", "oncobase")).toBe(false);
    expect(rootRouteFor(pathname, false, false, "oncobase")).not.toBe("reader");
  }
});

test("the decision is self-contained, because it is inlined into the document by source", () => {
  const inlined = new Function(`return (${startsReader.toString()})`)() as typeof startsReader;
  expect(inlined("diana-tnbc.com", "/", "landing", null)).toBe(false);
  expect(inlined("diana-tnbc.com", "/wiki/page", "wiki", null)).toBe(true);
});
