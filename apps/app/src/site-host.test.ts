import { describe, expect, test } from "bun:test";
import { isOncobaseHost, ONCOBASE_HOST_PATTERN, siteKindForHost, siteOrigin } from "./site-host";

describe("site hosts", () => {
  test("oncobase.io, its subdomains, and oncobase.localhost serve the marketing site", () => {
    for (const host of ["oncobase.io", "www.oncobase.io", "ONCOBASE.IO:443", "oncobase.localhost:60377", "x.oncobase.io"]) {
      expect(isOncobaseHost(host), host).toBe(true);
    }
  });

  test("everything else is Diana's site, including lookalikes", () => {
    for (const host of ["diana-tnbc.com", "localhost:3000", "127.0.0.1", "notoncobase.io", "oncobase.io.evil.com", "oncobase.com", "", null, undefined]) {
      expect(isOncobaseHost(host), String(host)).toBe(false);
      expect(siteKindForHost(host)).toBe("diana");
    }
  });

  test("preview aliases can be added", () => {
    expect(isOncobaseHost("oncobase-preview.vercel.app")).toBe(false);
    expect(isOncobaseHost("oncobase-preview.vercel.app", ["oncobase-preview.vercel.app"])).toBe(true);
  });

  test("links to the other site keep the port on localhost and use the real domain elsewhere", () => {
    const local = { protocol: "http:", hostname: "127.0.0.1", port: "60377" };
    expect(siteOrigin("oncobase", local)).toBe("http://oncobase.localhost:60377");
    expect(siteOrigin("diana", { ...local, hostname: "oncobase.localhost" })).toBe("http://localhost:60377");
    expect(siteOrigin("oncobase", { protocol: "https:", hostname: "diana-tnbc.com", port: "" })).toBe("https://oncobase.io");
    expect(siteOrigin("diana", { protocol: "https:", hostname: "oncobase.io", port: "" })).toBe("https://diana-tnbc.com");
    expect(siteOrigin("diana", null)).toBe("https://diana-tnbc.com");
  });

  test("the inline head scripts copy the host pattern", async () => {
    const copies = ["src/bootstrap/reader-shortcuts.ts", "scripts/reader-preload-plugin.ts"];
    for (const file of copies) {
      const source = await Bun.file(new URL(`../${file}`, import.meta.url)).text();
      expect(source, file).toContain(ONCOBASE_HOST_PATTERN);
    }
  });
});
