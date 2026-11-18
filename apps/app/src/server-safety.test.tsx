// SSR stage 0 (plans/2026-11-17-server-rendering-plan.md §2.1): the reader's
// first frame must render with no DOM. These tests run under Bun without
// `window` or `document`, as a server render does.
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
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
