import { describe, expect, test } from "bun:test";
import { formatLiveblocksUserId } from "./liveblocks-user-format";

describe("formatLiveblocksUserId", () => {
  test("uses stable labels for guest and anonymous users", () => {
    expect(formatLiveblocksUserId("guest_123")).toBe("Guest");
    expect(formatLiveblocksUserId("guest:markdown:about/About")).toBe("Guest");
    expect(formatLiveblocksUserId("anonymous")).toBe("Anonymous");
  });

  test("hides raw Convex IDs and truncates unknown long IDs", () => {
    expect(formatLiveblocksUserId("a".repeat(32))).toBe("User");
    expect(formatLiveblocksUserId("external-provider-user-123")).toBe(
      "external-pro..."
    );
  });
});
