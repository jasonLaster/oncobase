import { describe, expect, test } from "bun:test";
import { formatLiveblocksUserId } from "./user-format";

describe("formatLiveblocksUserId", () => {
  test("formats anonymous and guest users for display", () => {
    expect(formatLiveblocksUserId("anonymous")).toBe("Anonymous");
    expect(formatLiveblocksUserId("guest_123")).toBe("Guest");
    expect(formatLiveblocksUserId("guest:123")).toBe("Guest");
  });

  test("hides opaque generated user ids", () => {
    expect(formatLiveblocksUserId("0123456789abcdef0123456789abcdef")).toBe("User");
  });

  test("keeps short ids and truncates long ids", () => {
    expect(formatLiveblocksUserId("clinician")).toBe("clinician");
    expect(formatLiveblocksUserId("clinician@example.com")).toBe("clinician@ex...");
    expect(formatLiveblocksUserId("very-long-liveblocks-user-id")).toBe("very-long-li...");
  });
});
