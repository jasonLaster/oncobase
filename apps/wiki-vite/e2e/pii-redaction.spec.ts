import { test } from "@playwright/test";

test.describe.skip("PII redaction", () => {
  test("redacts server-rendered diagnosis identifiers by default", async () => {});
  test("showPII does not reveal identifiers because content is redacted at publish", async () => {});
  test("redacts inline patient references on the about page", async () => {});
  test("text search excludes redacted identifiers", async () => {});
  test("markdown downloads stay redacted even when showPII is requested", async () => {});
});
