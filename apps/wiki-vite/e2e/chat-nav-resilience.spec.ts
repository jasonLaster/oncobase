import { test } from "@playwright/test";

test.describe.skip("P0 chat navigation resilience", () => {
  test("Stop button aborts the model server-side", async () => {});
  test("Submit + navigate away + return shows the assistant message", async () => {});
  test("Refresh mid-stream keeps the conversation observable", async () => {});
  test("Failed streams clear streaming state and keep the conversation recoverable", async () => {});
});
