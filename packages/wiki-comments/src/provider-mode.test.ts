import { describe, expect, test } from "bun:test";
import { resolveLiveblocksProviderMode } from "./provider-mode.ts";

describe("resolveLiveblocksProviderMode", () => {
  test("uses authenticated sessions when the server is configured", () => {
    expect(
      resolveLiveblocksProviderMode({
        authConfigured: true,
        publicApiKey: null,
      }),
    ).toBe("auth");
  });

  test("allows an explicitly configured public development project", () => {
    expect(
      resolveLiveblocksProviderMode({
        authConfigured: false,
        publicApiKey: "pk_dev_explicit",
      }),
    ).toBe("public");
  });

  test("fails closed when no Liveblocks credentials are available", () => {
    expect(
      resolveLiveblocksProviderMode({
        authConfigured: false,
        publicApiKey: null,
      }),
    ).toBe("unavailable");
  });
});
