// REGRESSION GUARD for V-2 (see specs/chat-pii-security-audit-2026-10-05.md), mitigated by
// EMAIL_PATTERN_GRANTS_BEFORE. The original finding:
// accounts are created with an unverified email, and a role's "Auto-assign
// emails" patterns grant the role to anyone who registers a matching address.
// Anyone holding the (shared) gate password can therefore claim a care-team
// address that has not registered yet and read every sensitive page.
import { expect, test } from "bun:test";
import { EMAIL_PATTERN_GRANTS_BEFORE } from "../convex/access";
import { api } from "../convex/_generated/api";
import { handleAuthSignupRequest } from "./api/auth";
import { handleToolsRequest } from "./api/tools";
import { SECRET_BODY, SITE, createFixture, jsonRequest } from "./chat-security-fixture";
import { USER_SESSION_COOKIE } from "./user-auth";

test("registering an unverified email must not inherit email-pattern role grants to sensitive pages", async () => {
  const fixture = await createFixture({ passwordGate: false });
  await fixture.t.run((ctx) => ctx.db.patch(fixture.ids.role, { emailPatterns: ["new.doctor@hospital.test"] }));
  expect((await fixture.service.query(api.users.getByEmailForAuth, { siteSlug: SITE, email: "new.doctor@hospital.test" }))).toBeNull();

  const signup = await handleAuthSignupRequest(
    jsonRequest("/api/auth/signup", { email: "new.doctor@hospital.test", password: "attacker-chosen-password" }), fixture.client, SITE);
  expect(signup.status).toBe(200);
  const cookie = signup.headers.get("set-cookie")!.split(";")[0]!;
  expect(cookie.startsWith(`${USER_SESSION_COOKIE}=`)).toBe(true);

  const search = await handleToolsRequest(jsonRequest("/api/tools", { tool: "search_wiki", args: { query: SECRET_BODY } }, cookie), fixture.client, SITE);
  // Secure behaviour: an unverified address gets no sensitive hits.
  expect(JSON.stringify(await search.json())).not.toContain("private/care-team-notes");
});

test("accounts that existed before the cutoff keep their email-pattern role grants", async () => {
  const fixture = await createFixture({ passwordGate: false });
  await fixture.t.run((ctx) => ctx.db.patch(fixture.ids.role, { emailPatterns: ["existing.doctor@hospital.test"] }));
  const signup = await handleAuthSignupRequest(
    jsonRequest("/api/auth/signup", { email: "existing.doctor@hospital.test", password: "a-long-test-password" }), fixture.client, SITE);
  const cookie = signup.headers.get("set-cookie")!.split(";")[0]!;
  // Pretend the account predates the cutoff, as every real account does.
  await fixture.t.run(async (ctx) => {
    const user = (await ctx.db.query("users").collect()).find((row) => row.email === "existing.doctor@hospital.test")!;
    await ctx.db.patch(user._id, { createdAt: EMAIL_PATTERN_GRANTS_BEFORE - 1 });
  });
  const search = await handleToolsRequest(jsonRequest("/api/tools", { tool: "search_wiki", args: { query: SECRET_BODY } }, cookie), fixture.client, SITE);
  expect(JSON.stringify(await search.json())).toContain("private/care-team-notes");
});
