import { test } from "@playwright/test";

test.describe.skip("page metadata", () => {
  test("renders page-specific title and description for authenticated wiki pages", async () => {});
  test("serves page-specific metadata to link preview bots without a login cookie", async () => {});
  test("keeps normal unauthenticated page requests behind login", async () => {});
});
