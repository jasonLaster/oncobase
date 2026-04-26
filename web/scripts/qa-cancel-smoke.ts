/**
 * Manual QA smoke: verify the cancel-stream Convex round trip works.
 * Used during the QA pass for chat-patterns Batch A.
 *
 *   bun scripts/qa-cancel-smoke.ts
 */

import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import dotenv from "dotenv";
import { join } from "node:path";

dotenv.config({ path: join(import.meta.dir, "..", ".env.local") });

async function main() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
  const convex = new ConvexHttpClient(url);

  console.log("[qa] connecting", url);

  const id = await convex.mutation(api.conversations.create, {
    title: "QA cancel smoke",
  });
  console.log("[qa] created", id);

  await convex.mutation(api.conversations.cancelStream, { conversationId: id });
  console.log("[qa] cancelStream OK");

  const state = await convex.query(api.conversations.getCancelState, {
    conversationId: id,
  });
  console.log("[qa] getCancelState:", state);
  if (!state?.canceledAt) throw new Error("canceledAt should be set");

  await convex.mutation(api.conversations.clearCancel, { conversationId: id });
  const state2 = await convex.query(api.conversations.getCancelState, {
    conversationId: id,
  });
  console.log("[qa] after clearCancel:", state2);
  if (state2?.canceledAt) throw new Error("canceledAt should be cleared");

  await convex.mutation(api.conversations.archive, { id });
  console.log("[qa] archived");
  console.log("[qa] PASS");
}

main().catch((e) => {
  console.error("[qa] FAIL:", e);
  process.exit(1);
});
