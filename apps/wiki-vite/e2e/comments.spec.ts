import { test } from "@playwright/test";

test.describe.skip("Document comments sidebar", () => {
  test("sidebar loads with Comments / Outline toggle", async () => {});
  test("sidebar shows thread count", async () => {});
  test("switching to Outline tab shows headings", async () => {});
  test("outline sidebar renders on document page", async () => {});
  test("open outline rail still exposes comments activation", async () => {});
  test("mobile bottom rail outline still exposes comments activation", async () => {});
  test("phone bottom rail switches between comments and outline", async () => {});
  test("ipad bottom rail switches between comments and outline", async () => {});
  test("comment and outline rail buttons toggle the rail", async () => {});
  test("comments rail can be resized", async () => {});
});

test.describe.skip("Comment actions dropdown", () => {
  test("comment actions menu opens with filter option", async () => {});
  test("toggling resolved filter changes thread count label", async () => {});
  test("per-comment actions dropdown opens above the rail", async () => {});
  test("reaction emoji picker opens above the rail", async () => {});
});

test.describe.skip("Creating comments", () => {
  test("page-level composer opens and has send button", async () => {});
  test("typing in composer enables send button", async () => {});
});

test.describe.skip("Text selection", () => {
  test("highlight overlay does not block text selection", async () => {});
  test("pending highlight renders behind article text", async () => {});
  test("draft selection thread renders in sorted list order", async () => {});
  test("opening a linked selection URL activates the thread", async () => {});
});

test.describe.skip("Global comments page", () => {
  test("loads and shows thread list", async () => {});
  test("comments page renders thread list or empty state", async () => {});
  test("thread cards link to source documents", async () => {});
  test("toggle between open and all comments", async () => {});
});

test.describe.skip("Delete thread", () => {
  test("delete-thread API rejects missing params", async () => {});
  test("delete thread menu item appears on first comment", async () => {});
  test("delete thread action keeps the comments rail open", async () => {});
});

test.describe.skip("Comments API endpoints", () => {
  test("liveblocks-auth GET returns configured status", async () => {});
  test("liveblocks-threads GET returns threads array", async () => {});
  test("auth session GET returns user object", async () => {});
  test("liveblocks-users rejects malformed IDs", async () => {});
  test("guest names are stored in Convex and resolvable to other users", async () => {});
  test("signed-in user names resolve from Convex user records", async () => {});
});

test.describe.skip("Sidebar navigation", () => {
  test("View comments link is visible in sidebar", async () => {});
  test("clicking View comments navigates to /comments", async () => {});
});
