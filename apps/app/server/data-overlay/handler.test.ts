import { expect, test } from "bun:test";
import type { DataOverlayConfig } from "./config";
import { createHandoffState, mintHandoffToken } from "./handoff";
import {
  DATA_SESSION_COOKIE,
  DATA_STATE_COOKIE,
  PRIVATE_URL_EXPIRY_SECONDS,
  PUBLIC_URL_EXPIRY_SECONDS,
  createDataOverlayHandler,
  type DataAuditEntry,
  type DataOverlaySessions,
  type DataUser,
} from "./handler";
import { MANIFEST_KEY } from "./index-page";
import type { DataOverlayStorage } from "./storage";

const NOW = 1_800_000_000_000;
const config: DataOverlayConfig = {
  dataOrigin: "https://data.diana-tnbc.com",
  mainOrigin: "https://diana-tnbc.com",
  siteSlug: "diana",
  handoffSecret: "h".repeat(48),
  secureCookies: true,
};

const USERS: Record<string, DataUser & { roles: string[] }> = {
  patient: { _id: "u-patient", email: "patient@example.com", roles: ["patient"] },
  admin: { _id: "u-admin", email: "admin@example.com", roles: ["admin"] },
  serova: { _id: "u-serova", email: "serova@example.com", roles: ["serova"] },
  reader: { _id: "u-reader", email: "reader@example.com", roles: [] },
};

const OBJECTS = [
  "private/slides/ucsf-svs/a.svs", "private/slides/ucsf-svs-deid/a.svs", "private/curefirst/plan.pdf",
  "private/companies/serova/deck.pdf", "private/curefirst/", "private/other/secret.txt", "staging/x",
];

function setup({ manifest = JSON.stringify({ datasets: [
  { path: "rna/kh022.h5ad", bytes: 2048, sha256: "abc", description: "KH022 <RNA>", source: "UCSF", timepoint: "2024", deidentification: "Safe Harbor", license: "CC-BY-4.0" },
  { path: "../private/curefirst/plan.pdf", bytes: 1 },
  { path: "private/x" },
  { nope: true },
] }) as string | null } = {}) {
  const presigned: { key: string; expiresIn: number; private: boolean }[] = [];
  const listed: string[] = [];
  const audits: DataAuditEntry[] = [];
  let manifestReads = 0;
  let clock = NOW;
  const tokens = new Map<string, keyof typeof USERS>(Object.keys(USERS).map(name => [`token-${name}`, name as keyof typeof USERS]));
  const created: { userId: string; expiresAt: number }[] = [];
  const storage: DataOverlayStorage = {
    async presignGet(key, expiresIn, options) {
      presigned.push({ key, expiresIn, private: options.private });
      return `https://bucket.s3.amazonaws.com/${key}?X-Amz-Expires=${expiresIn}&X-Amz-Signature=sig`;
    },
    async readText(key) {
      expect(key).toBe(MANIFEST_KEY);
      manifestReads += 1;
      return manifest;
    },
    async list(prefix, limit) {
      listed.push(prefix);
      return { objects: OBJECTS.filter(key => key.startsWith(prefix)).slice(0, limit).map(key => ({ key, bytes: 10, lastModified: null })), truncated: false };
    },
  };
  const sessions: DataOverlaySessions = {
    async userForToken(token) {
      const name = tokens.get(token);
      if (!name) return null;
      const { roles: _roles, ...user } = USERS[name]!;
      return user;
    },
    async rolesFor(user) {
      return Object.values(USERS).find(candidate => candidate._id === user._id)?.roles ?? [];
    },
    async createSession(userId, expiresAt) {
      created.push({ userId, expiresAt });
      const name = Object.entries(USERS).find(([, user]) => user._id === userId)?.[0];
      if (!name) throw new Error("user does not belong to this site");
      const token = `data-token-${created.length}`;
      tokens.set(token, name as keyof typeof USERS);
      return token;
    },
    async revoke(token) { tokens.delete(token); },
  };
  const handle = createDataOverlayHandler({ config, storage: () => storage, sessions, now: () => clock, audit: entry => { audits.push(entry); } });
  const request = (path: string, { cookie, bearer, accept, method = "GET", authorization }: { cookie?: string; bearer?: string; accept?: string; method?: string; authorization?: string } = {}) => {
    const headers = new Headers();
    if (cookie) headers.set("cookie", cookie);
    if (bearer) headers.set("authorization", `Bearer ${bearer}`);
    if (authorization) headers.set("authorization", authorization);
    if (accept) headers.set("accept", accept);
    const [pathname, query] = path.split("?");
    return handle(new Request(`https://data.diana-tnbc.com${query ? `/?${query}` : "/"}`, { method, headers }), pathname!);
  };
  return {
    request, presigned, listed, audits, created,
    get manifestReads() { return manifestReads; },
    advance(ms: number) { clock += ms; },
  };
}

const session = (name: keyof typeof USERS) => `${DATA_SESSION_COOKIE}=token-${name}`;

function expectPrivateHeaders(response: Response) {
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("cdn-cache-control")).toBe("no-store");
  expect(response.headers.get("vercel-cdn-cache-control")).toBe("no-store");
}

test("public paths redirect to a 15-minute presigned URL for public/<path>, for anyone", async () => {
  const t = setup();
  const response = await t.request("/rna/kh022.h5ad");
  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toContain("public/rna/kh022.h5ad");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("cdn-cache-control")).toBe("no-store");
  expect(response.headers.get("vercel-cdn-cache-control")).toBe("no-store");
  expect(t.presigned).toEqual([{ key: "public/rna/kh022.h5ad", expiresIn: PUBLIC_URL_EXPIRY_SECONDS, private: false }]);
  expect(PUBLIC_URL_EXPIRY_SECONDS).toBe(900);
  // A public-looking path can never reach a private key.
  expect((await t.request("/privatex/a")).status).toBe(302);
  expect(t.presigned.at(-1)!.key).toBe("public/privatex/a");
  for (const path of ["/public/../private/curefirst/plan.pdf", "/%2e%2e/private/curefirst/plan.pdf", "/a%2f..%2fprivate%2fcurefirst%2fplan.pdf", "//private/curefirst/plan.pdf"]) {
    expect((await t.request(path)).status).toBe(400);
  }
  expect(t.presigned).toHaveLength(2);
  expect(t.audits).toEqual([]);
});

test("anonymous private requests get the same sign-in redirect whether or not the key exists", async () => {
  const t = setup();
  const existing = await t.request("/private/curefirst/plan.pdf");
  const missing = await t.request("/private/curefirst/missing.pdf");
  const unmapped = await t.request("/private/other/secret.txt");
  for (const [response, path] of [[existing, "/private/curefirst/plan.pdf"], [missing, "/private/curefirst/missing.pdf"], [unmapped, "/private/other/secret.txt"]] as const) {
    expect(response.status).toBe(302);
    expectPrivateHeaders(response);
    const location = new URL(response.headers.get("location")!);
    expect(`${location.origin}${location.pathname}`).toBe("https://diana-tnbc.com/api/data-overlay/handoff");
    expect(location.searchParams.get("next")).toBe(path);
    const state = location.searchParams.get("state")!;
    expect(response.headers.get("set-cookie")).toBe(`${DATA_STATE_COOKIE}=${state}; HttpOnly; SameSite=Lax; Path=/_auth/; Max-Age=600; Secure`);
  }
  expect(t.presigned).toEqual([]);
  expect(t.listed).toEqual([]);
});

test("signed-in users without the role get a 404 and nothing is signed", async () => {
  const t = setup();
  for (const [name, path] of [
    ["reader", "/private/curefirst/plan.pdf"],
    ["serova", "/private/curefirst/plan.pdf"],
    ["admin", "/private/companies/serova/deck.pdf"],
    ["patient", "/private/other/secret.txt"],
    ["patient", "/private/curefirstX/plan.pdf"],
  ] as const) {
    const response = await t.request(path, { cookie: session(name) });
    expect(response.status).toBe(404);
    expectPrivateHeaders(response);
    expect(await response.text()).toBe("Not found");
  }
  expect(t.presigned).toEqual([]);
  expect(t.audits.map(entry => [entry.email, entry.key, entry.outcome])).toEqual([
    ["reader@example.com", "private/curefirst/plan.pdf", "denied"],
    ["serova@example.com", "private/curefirst/plan.pdf", "denied"],
    ["admin@example.com", "private/companies/serova/deck.pdf", "denied"],
    ["patient@example.com", "private/other/secret.txt", "denied"],
    ["patient@example.com", "private/curefirstX/plan.pdf", "denied"],
  ]);
});

test("permitted users get a 5-minute private, uncacheable redirect, and it is audited", async () => {
  const t = setup();
  const response = await t.request("/private/companies/serova/deck.pdf", { cookie: `other=1; ${session("serova")}` });
  expect(response.status).toBe(302);
  expectPrivateHeaders(response);
  expect(response.headers.get("location")).toContain("private/companies/serova/deck.pdf");
  expect(t.presigned).toEqual([{ key: "private/companies/serova/deck.pdf", expiresIn: PRIVATE_URL_EXPIRY_SECONDS, private: true }]);
  expect(PRIVATE_URL_EXPIRY_SECONDS).toBeLessThanOrEqual(300);
  expect(t.audits).toEqual([{
    event: "data_overlay.private_access", time: new Date(NOW).toISOString(), outcome: "granted",
    userId: "u-serova", email: "serova@example.com", via: "cookie", key: "private/companies/serova/deck.pdf", expiresInSeconds: 300,
  }]);
});

test("account bearer tokens are accepted; invalid ones are refused without a redirect", async () => {
  const t = setup();
  const ok = await t.request("/private/slides/ucsf-svs-deid/a.svs", { bearer: "token-admin" });
  expect(ok.status).toBe(302);
  expect(t.audits.at(-1)).toMatchObject({ via: "bearer", userId: "u-admin", outcome: "granted" });
  for (const authorization of ["Bearer forged", "Bearer ", "Basic abc", "Bearer a b"]) {
    const response = await t.request("/private/slides/ucsf-svs-deid/a.svs", { authorization, cookie: session("admin") });
    expect(response.status).toBe(401);
    expectPrivateHeaders(response);
    expect(response.headers.get("location")).toBeNull();
  }
  // ?access_token= is not an accepted credential here.
  const query = await t.request("/private/slides/ucsf-svs-deid/a.svs?access_token=token-admin");
  expect(query.status).toBe(302);
  expect(query.headers.get("location")).toStartWith("https://diana-tnbc.com/");
  expect(t.presigned).toHaveLength(1);
});

test("an unknown or expired data session is treated as anonymous", async () => {
  const t = setup();
  const response = await t.request("/private/curefirst/plan.pdf", { cookie: `${DATA_SESSION_COOKIE}=revoked` });
  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toStartWith("https://diana-tnbc.com/api/data-overlay/handoff?");
  // The main-site cookie means nothing on this host.
  const main = await t.request("/private/curefirst/plan.pdf", { cookie: "wiki_user_session=token-admin" });
  expect(main.headers.get("location")).toStartWith("https://diana-tnbc.com/api/data-overlay/handoff?");
  expect(t.presigned).toEqual([]);
});

test("the handoff callback exchanges a valid token for a host-only session cookie", async () => {
  const t = setup();
  const state = createHandoffState();
  const token = mintHandoffToken({ sub: "u-patient", site: "diana", aud: config.dataOrigin, state }, config.handoffSecret!, NOW);
  const callback = `/_auth/callback?${new URLSearchParams({ token, next: "/private/curefirst/plan.pdf" })}`;
  const response = await t.request(callback, { cookie: `${DATA_STATE_COOKIE}=${state}` });
  expect(response.status).toBe(302);
  expectPrivateHeaders(response);
  expect(response.headers.get("location")).toBe("https://data.diana-tnbc.com/private/curefirst/plan.pdf");
  const cookies = response.headers.getSetCookie();
  expect(cookies[0]).toBe(`${DATA_SESSION_COOKIE}=data-token-1; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200; Secure`);
  expect(cookies[0]).not.toContain("Domain");
  expect(cookies[1]).toStartWith(`${DATA_STATE_COOKIE}=; `);
  expect(t.created).toEqual([{ userId: "u-patient", expiresAt: NOW + 43_200_000 }]);
  const file = await t.request("/private/curefirst/plan.pdf", { cookie: `${DATA_SESSION_COOKIE}=data-token-1` });
  expect(file.status).toBe(302);
  expect(t.presigned.at(-1)).toEqual({ key: "private/curefirst/plan.pdf", expiresIn: 300, private: true });
});

test("expired, forged, replayed-elsewhere and misdirected handoffs create no session", async () => {
  const t = setup();
  const state = createHandoffState();
  const mint = (overrides: Partial<{ sub: string; site: string; aud: string; state: string }> = {}, at = NOW, secret = config.handoffSecret!) =>
    mintHandoffToken({ sub: "u-patient", site: "diana", aud: config.dataOrigin, state, ...overrides }, secret, at);
  const cases: [string, string | undefined][] = [
    [mint({}, NOW - 61_000), `${DATA_STATE_COOKIE}=${state}`],
    [mint({}, NOW, "f".repeat(48)), `${DATA_STATE_COOKIE}=${state}`],
    [`${mint().split(".")[0]}.AAAA`, `${DATA_STATE_COOKIE}=${state}`],
    [mint(), undefined],
    [mint(), `${DATA_STATE_COOKIE}=${createHandoffState()}`],
    [mint({ aud: "https://evil.example" }), `${DATA_STATE_COOKIE}=${state}`],
    [mint({ site: "other" }), `${DATA_STATE_COOKIE}=${state}`],
    ["garbage", `${DATA_STATE_COOKIE}=${state}`],
  ];
  for (const [token, cookie] of cases) {
    const response = await t.request(`/_auth/callback?${new URLSearchParams({ token, next: "/private/curefirst/plan.pdf" })}`, { cookie });
    expect(response.status).toBe(401);
    expectPrivateHeaders(response);
    expect(response.headers.getSetCookie().some(value => value.startsWith(`${DATA_SESSION_COOKIE}=`))).toBe(false);
  }
  // A valid token for a user who no longer exists.
  const gone = await t.request(`/_auth/callback?${new URLSearchParams({ token: mint({ sub: "u-deleted" }) })}`, { cookie: `${DATA_STATE_COOKIE}=${state}` });
  expect(gone.status).toBe(401);
  expect(t.created.filter(entry => entry.userId !== "u-deleted")).toEqual([]);
});

test("the callback never redirects off the data host", async () => {
  const t = setup();
  const state = createHandoffState();
  const token = mintHandoffToken({ sub: "u-patient", site: "diana", aud: config.dataOrigin, state }, config.handoffSecret!, NOW);
  for (const next of ["//evil.example/x", "https://evil.example/", "/\\evil.example"]) {
    const response = await t.request(`/_auth/callback?${new URLSearchParams({ token, next })}`, { cookie: `${DATA_STATE_COOKIE}=${state}` });
    expect(response.headers.get("location")).toBe("https://data.diana-tnbc.com/");
  }
});

test("sign out revokes the data session", async () => {
  const t = setup();
  expect((await t.request("/_auth/signout", { method: "GET" })).status).toBe(405);
  const response = await t.request("/_auth/signout", { method: "POST", cookie: session("admin") });
  expect(response.status).toBe(303);
  expect(response.headers.get("set-cookie")).toStartWith(`${DATA_SESSION_COOKIE}=; `);
  const after = await t.request("/private/curefirst/plan.pdf", { cookie: session("admin") });
  expect(after.headers.get("location")).toStartWith("https://diana-tnbc.com/");
});

test("the index lists only what the current viewer may read", async () => {
  const t = setup();
  const json = async (options: Parameters<typeof t.request>[1] = {}) => {
    const response = await t.request("/index.json", options);
    expectPrivateHeaders(response);
    return response.json() as Promise<{ datasets: { path: string; url: string }[]; private: { key: string; url: string }[]; viewer: unknown }>;
  };
  const anonymous = await json();
  expect(anonymous.datasets.map(dataset => [dataset.path, dataset.url])).toEqual([["rna/kh022.h5ad", "/rna/kh022.h5ad"]]);
  expect(anonymous.private).toEqual([]);
  expect(anonymous.viewer).toBeNull();
  expect(t.listed).toEqual([]);

  expect((await json({ cookie: session("reader") })).private).toEqual([]);
  expect(t.listed).toEqual([]);
  expect((await json({ cookie: session("serova") })).private.map(item => item.key)).toEqual(["private/companies/serova/deck.pdf"]);
  expect((await json({ cookie: session("admin") })).private.map(item => item.key)).toEqual([
    "private/curefirst/plan.pdf", "private/slides/ucsf-svs-deid/a.svs", "private/slides/ucsf-svs/a.svs",
  ]);
  const patient = await json({ bearer: "token-patient" });
  expect(patient.private.map(item => item.url)).toEqual([
    "/private/companies/serova/deck.pdf", "/private/curefirst/plan.pdf", "/private/slides/ucsf-svs-deid/a.svs", "/private/slides/ucsf-svs/a.svs",
  ]);
  expect(t.listed.some(prefix => !prefix.startsWith("private/") || prefix === "private/")).toBe(false);
  // The manifest is read once per cache window.
  expect(t.manifestReads).toBe(1);
  t.advance(61_000);
  await json();
  expect(t.manifestReads).toBe(2);
  expect((await t.request("/index.json", { bearer: "forged" })).status).toBe(401);
});

test("the index is HTML by default and JSON on request, and escapes manifest text", async () => {
  const t = setup();
  const html = await t.request("/", { accept: "text/html,application/xhtml+xml" });
  expect(html.headers.get("content-type")).toBe("text/html; charset=utf-8");
  expectPrivateHeaders(html);
  const body = await html.text();
  expect(body).toContain("KH022 &#60;RNA&#62;");
  expect(body).not.toContain("<RNA>");
  expect(body).toContain("/_auth/signin?next=%2F");
  expect(body).not.toContain("curefirst");
  const json = await t.request("/", { accept: "application/json" });
  expect(json.headers.get("content-type")).toBe("application/json; charset=utf-8");
  const signedIn = await (await t.request("/", { cookie: session("admin") })).text();
  expect(signedIn).toContain("/private/curefirst/plan.pdf");
  expect(signedIn).not.toContain("serova/deck.pdf");
});

test("a missing or malformed manifest is an empty index", async () => {
  for (const manifest of [null, "not json", JSON.stringify({ datasets: "x" })]) {
    const t = setup({ manifest });
    const response = await t.request("/index.json");
    expect(response.status).toBe(200);
    expect((await response.json()).datasets).toEqual([]);
  }
});

test("other methods are refused", async () => {
  const t = setup();
  expect((await t.request("/rna/x", { method: "POST" })).status).toBe(405);
  expect((await t.request("/private/curefirst/plan.pdf", { method: "DELETE", cookie: session("admin") })).status).toBe(405);
  expect(t.presigned).toEqual([]);
});
