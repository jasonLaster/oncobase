import { afterAll, expect, test } from "bun:test";
import { backendRequestTimeoutMs, backendServiceToken, createBackendClient } from "./backend-client";
import { api } from "../convex/_generated/api";
import { SERVICE_ISSUER, SERVICE_AUDIENCE, SERVICE_SUBJECT } from "../convex/lib/serviceAuth";
const previous = process.env.WIKI_BACKEND_SIGNING_KEY;
afterAll(() => { if (previous === undefined) delete process.env.WIKI_BACKEND_SIGNING_KEY; else process.env.WIKI_BACKEND_SIGNING_KEY = previous; });
const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1,0,1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const privateJwk = { ...await crypto.subtle.exportKey("jwk", pair.privateKey), kid: "unit-fixture" };
const decode = (value: string) => Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));

test("service JWTs are signed, bounded, scoped and refreshed", async () => {
  process.env.WIKI_BACKEND_SIGNING_KEY = JSON.stringify(privateJwk);
  const now = Date.now(), token = await backendServiceToken(now);
  const [header, payload, signature] = token.split(".") as [string,string,string];
  expect(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", pair.publicKey, decode(signature), new TextEncoder().encode(header + "." + payload))).toBe(true);
  const claims = JSON.parse(new TextDecoder().decode(decode(payload)));
  expect(claims).toMatchObject({ iss: SERVICE_ISSUER, aud: SERVICE_AUDIENCE, sub: SERVICE_SUBJECT, role: "backend-service" });
  expect(claims.exp - claims.iat).toBe(120);
  expect(await backendServiceToken(now + 1000)).toBe(token);
  expect(await backendServiceToken(now + 61_000)).not.toBe(token);
});

test("backend transport sends credentials only in headers to its configured origin", async () => {
  let calls = 0;
  const transport = Object.assign(async (_input: unknown, init?: RequestInit) => {
    calls++;
    expect(new Headers(init?.headers).get("Authorization")).toStartWith("Bearer ");
    expect(init?.body).not.toContain("backend-service");
    expect(init?.body).not.toContain(privateJwk.d!);
    expect(init?.redirect).toBe("error");
    return Response.json({ status: "success", value: null });
  }, { preconnect: fetch.preconnect });
  const client = createBackendClient("https://fixture.convex.cloud", { fetch: transport });
  await client.query(api.sites.getByHost, { host: "alpha.test" });
  expect(calls).toBe(1);
  delete process.env.WIKI_BACKEND_SIGNING_KEY;
  await expect(client.query(api.sites.getByHost, { host: "alpha.test" })).rejects.toThrow("not configured");
  expect(calls).toBe(1);
});

test("backend RPCs carry a timeout signal, longer for actions and configurable", () => {
  expect(backendRequestTimeoutMs("/api/query", {})).toBe(15_000);
  expect(backendRequestTimeoutMs("/api/mutation", {})).toBe(15_000);
  expect(backendRequestTimeoutMs("/api/action", {})).toBe(60_000);
  expect(backendRequestTimeoutMs("/api/query", { WIKI_BACKEND_TIMEOUT_MS: "250" })).toBe(250);
  expect(backendRequestTimeoutMs("/api/action", { WIKI_BACKEND_ACTION_TIMEOUT_MS: "0" })).toBe(0);
  expect(backendRequestTimeoutMs("/api/query", { WIKI_BACKEND_TIMEOUT_MS: "nonsense" })).toBe(15_000);
});

test("a stalled backend call is aborted instead of outliving the request", async () => {
  process.env.WIKI_BACKEND_SIGNING_KEY = JSON.stringify(privateJwk);
  const previousTimeout = process.env.WIKI_BACKEND_TIMEOUT_MS;
  process.env.WIKI_BACKEND_TIMEOUT_MS = "20";
  try {
    let sawSignal = false;
    const transport = Object.assign((_input: unknown, init?: RequestInit) => new Promise<Response>((_, reject) => {
      sawSignal = init?.signal instanceof AbortSignal;
      init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
    }), { preconnect: fetch.preconnect });
    const client = createBackendClient("https://fixture.convex.cloud", { fetch: transport });
    const started = Date.now();
    await expect(client.query(api.sites.getByHost, { host: "alpha.test" })).rejects.toThrow();
    expect(sawSignal).toBe(true);
    expect(Date.now() - started).toBeLessThan(2_000);
  } finally {
    if (previousTimeout === undefined) delete process.env.WIKI_BACKEND_TIMEOUT_MS; else process.env.WIKI_BACKEND_TIMEOUT_MS = previousTimeout;
    delete process.env.WIKI_BACKEND_SIGNING_KEY;
  }
});
