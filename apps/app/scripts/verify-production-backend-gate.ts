/** Read-only verification. Never logs responses, cookies, credentials or content. */
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
const origin = process.env.WIKI_PERF_ORIGIN ?? "https://diana-tnbc.com";
const password = process.env.WIKI_PERF_PASSWORD;
if (!password) throw new Error("WIKI_PERF_PASSWORD is required");
const backend = "https://youthful-cricket-560.convex.cloud";
const anonymous = new ConvexHttpClient(backend, { logger: false });
async function denied(name: string, read: () => Promise<unknown>) {
  let denied = false;
  try { await read(); } catch (error) { denied = /Unauthorized|Unauthenticated|authenticat|JWT|token/i.test(String(error)); }
  console.log(JSON.stringify({ name, denied }));
  if (!denied) throw new Error("Backend authorization check failed: " + name);
}
await denied("reader policy", () => anonymous.query(api.documents.getReaderPolicy, { host: "diana-tnbc.com" }));
await denied("reader page", () => anonymous.query(api.documents.getReaderPage, { host: "diana-tnbc.com", slug: "index" }));
await denied("legacy document query", () => anonymous.query(api.documents.getBySlug, { siteSlug: "diana", slug: "index" }));
await denied("legacy bulk query", () => anonymous.query(api.documents.listPageWithContent, { siteSlug: "diana", cursor: null, numItems: 1 }));
await denied("site configuration by slug", () => anonymous.query(api.sites.getBySlug, { slug: "diana" }));
await denied("site configuration by host", () => anonymous.query(api.sites.getByHost, { host: "diana-tnbc.com" }));
await denied("account lookup", () => anonymous.query(api.users.getByEmailForAuth, { siteSlug: "diana", email: "nonexistent-security-fixture@example.invalid" }));
await denied("chat metadata", () => anonymous.query(api.conversations.getMeta, { siteSlug: "diana", id: "nonexistent-security-fixture" }));
anonymous.setAuth("forged.invalid.signature");
await denied("forged bearer", () => anonymous.query(api.documents.getReaderPolicy, { host: "diana-tnbc.com" }));
const noCookie = await fetch(origin + "/api/wiki/convex-token");
if (noCookie.status !== 401) throw new Error("Anonymous browser credential request was not denied");
await noCookie.body?.cancel();
const login = await fetch(origin + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
const cookie = login.headers.get("set-cookie")?.split(";")[0];
await login.body?.cancel();
if (!login.ok || !cookie) throw new Error("Authorized login failed");
const response = await fetch(origin + "/api/wiki/convex-token", { headers: { Cookie: cookie } });
if (!response.ok || response.headers.get("cache-control") !== "private, no-store") throw new Error("Browser credential endpoint failed");
const { token } = await response.json() as { token: string };
const browser = new ConvexHttpClient(backend, { logger: false }); browser.setAuth(token);
if (await browser.query(api.conversations.getMeta, { siteSlug: "diana", id: "nonexistent-security-fixture" }) !== null) throw new Error("Unexpected fixture metadata");
await denied("browser credential cannot read document backend", () => browser.query(api.documents.getReaderPage, { host: "diana-tnbc.com", slug: "index" }));
await denied("browser credential cannot retrieve site configuration", () => browser.query(api.sites.getBySlug, { slug: "diana" }));
await denied("browser credential cannot cross sites", () => browser.query(api.conversations.list, { siteSlug: "security-fixture" }));
console.log(JSON.stringify({ anonymousBrowserCredentialDenied: true, validGateLogin: true, scopedBrowserCredentialAccepted: true, privateCredentialResponse: true }));
