import { describe, expect, test } from "bun:test";
import { asksForSignIn, signInHref, signInRedirectTarget } from "./sign-in";

describe("sign-in routing", () => {
  test("goes straight to the password only for a particular page", () => {
    expect(asksForSignIn("")).toBe(false);
    expect(asksForSignIn("?redirect=%2F")).toBe(false);
    expect(asksForSignIn("?redirect=%2Fwiki%2Fcare%2Findex")).toBe(true);
    // An unsafe target still asks for the password, then falls back to home.
    expect(asksForSignIn("?redirect=https%3A%2F%2Fevil.example")).toBe(true);
  });

  test("continues to the requested page with its own fragment", () => {
    expect(signInHref("/wiki/care/index")).toBe(
      "/sign-in?redirect=%2Fwiki%2Fcare%2Findex",
    );
    expect(
      signInRedirectTarget({
        search: "?redirect=%2Fwiki%2Fcare%2Findex",
        hash: "#plan",
      }),
    ).toBe("/wiki/care/index#plan");
    expect(
      signInRedirectTarget({
        search: "?redirect=%2Fwiki%2Fx%23kept",
        hash: "#ignored",
      }),
    ).toBe("/wiki/x#kept");
    expect(signInRedirectTarget({ search: "", hash: "" })).toBe("/");
    for (const target of [
      "https://evil.example/phish",
      "//evil.example/phish",
    ]) {
      expect(
        signInRedirectTarget({
          search: `?redirect=${encodeURIComponent(target)}`,
          hash: "",
        }),
      ).toBe("/");
    }
  });
});
