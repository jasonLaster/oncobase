import { afterEach, describe, expect, test } from "bun:test";
import {
  PLACEHOLDER_CONVEX_URL,
  PROD_CONVEX_FALLBACK_URL,
  resolvePublicConvexUrl,
  resolveServerConvexUrl,
  shouldSkipConvexReads,
} from "./convex-url";

const originalConvexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const originalServerConvexUrl = process.env.CONVEX_URL;
const originalUseProdConvex = process.env.NEXT_PUBLIC_USE_PROD_CONVEX;

function restoreEnv(name: "NEXT_PUBLIC_CONVEX_URL" | "CONVEX_URL" | "NEXT_PUBLIC_USE_PROD_CONVEX", value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

afterEach(() => {
  restoreEnv("NEXT_PUBLIC_CONVEX_URL", originalConvexUrl);
  restoreEnv("CONVEX_URL", originalServerConvexUrl);
  restoreEnv("NEXT_PUBLIC_USE_PROD_CONVEX", originalUseProdConvex);
});

describe("shared Convex URL resolution", () => {
  test("defaults public and server clients to the production Convex deployment", () => {
    delete process.env.NEXT_PUBLIC_CONVEX_URL;
    delete process.env.CONVEX_URL;
    delete process.env.NEXT_PUBLIC_USE_PROD_CONVEX;

    expect(resolvePublicConvexUrl()).toBe(PROD_CONVEX_FALLBACK_URL);
    expect(resolveServerConvexUrl()).toBe(PROD_CONVEX_FALLBACK_URL);
    expect(shouldSkipConvexReads()).toBe(false);
  });

  test("treats the placeholder URL as production data by default", () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = PLACEHOLDER_CONVEX_URL;
    delete process.env.CONVEX_URL;
    delete process.env.NEXT_PUBLIC_USE_PROD_CONVEX;

    expect(resolvePublicConvexUrl()).toBe(PROD_CONVEX_FALLBACK_URL);
    expect(resolveServerConvexUrl()).toBe(PROD_CONVEX_FALLBACK_URL);
  });

  test("allows explicit public Convex deployments to override the production default", () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://public.convex.cloud";
    process.env.CONVEX_URL = "https://server.convex.cloud";

    expect(resolvePublicConvexUrl()).toBe("https://public.convex.cloud");
    expect(resolveServerConvexUrl()).toBe("https://public.convex.cloud");
  });

  test("keeps public resolution on the production fallback when only server URL is set", () => {
    delete process.env.NEXT_PUBLIC_CONVEX_URL;
    process.env.CONVEX_URL = "https://server.convex.cloud";

    expect(resolvePublicConvexUrl()).toBe(PROD_CONVEX_FALLBACK_URL);
    expect(resolveServerConvexUrl()).toBe("https://server.convex.cloud");
  });

  test("can explicitly disable the production fallback", () => {
    delete process.env.NEXT_PUBLIC_CONVEX_URL;
    delete process.env.CONVEX_URL;
    process.env.NEXT_PUBLIC_USE_PROD_CONVEX = "0";

    expect(resolvePublicConvexUrl()).toBe("");
    expect(resolveServerConvexUrl()).toBe("");
    expect(shouldSkipConvexReads()).toBe(true);
  });
});
