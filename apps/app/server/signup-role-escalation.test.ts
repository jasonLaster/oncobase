// CONFIRMED VULNERABILITY V-2 (see specs/chat-pii-security-audit-2026-10-05.md):
// accounts are created with an unverified email, and a role's "Auto-assign
// emails" patterns grant the role to anyone who registers a matching address.
// Anyone holding the (shared) gate password can therefore claim a care-team
// address that has not registered yet and read every sensitive page.
//
// `test.failing` passes while the vulnerability exists and starts failing the
// moment it is fixed: then delete `.failing` so the test guards the fix.
import { expect, test } from "bun:test";
import { api } from "../convex/_generated/api";
import { handleAuthSignupRequest } from "./api/auth";
import { handleToolsRequest } from "./api/tools";
import { SECRET_BODY, SITE, createFixture, jsonRequest } from "./chat-security-fixture";
import { USER_SESSION_COOKIE } from "./user-auth";

test.failing("registering an unverified email must not inherit email-pattern role grants to sensitive pages", async () => {
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
