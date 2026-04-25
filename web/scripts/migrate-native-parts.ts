/**
 * Drives the 0007_native_parts migration end-to-end.
 *
 *   bun scripts/migrate-native-parts.ts                 # dry run
 *   bun scripts/migrate-native-parts.ts --apply         # actually migrate
 *   bun scripts/migrate-native-parts.ts --apply --yes   # skip prompt
 *
 * See web/specs/chat-performance-plan.md Phase 2.
 */

import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import dotenv from "dotenv";
import { join } from "node:path";
import * as readline from "node:readline";

dotenv.config({ path: join(import.meta.dir, "..", ".env.local") });
dotenv.config({ path: join(import.meta.dir, "..", ".env") });

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) {
  console.error("NEXT_PUBLIC_CONVEX_URL not set");
  process.exit(1);
}
const convex = new ConvexHttpClient(url);

interface DryRunResult {
  totalMessages: number;
  messagesNeedingMigration: number;
  malformedMessages: number;
  totalConversations: number;
  conversationsNeedingMigration: number;
  malformedConversations: number;
}

interface BatchResult {
  scanned: number;
  migrated: number;
  malformed: number;
  hasMore: boolean;
  cursor: string | null;
}

// `api.migrations` is added to the generated api by Convex codegen the first
// time `bunx convex dev` runs after this commit. Until then this script
// accesses it dynamically and casts to the FunctionReference shape.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const migrations = (api as any).migrations as {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  nativePartsDryRun: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  nativePartsMessagesBatch: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  nativePartsConversationsBatch: any;
};

const args = new Set(process.argv.slice(2));
const APPLY = args.has("--apply");
const YES = args.has("--yes");

async function confirm(prompt: string): Promise<boolean> {
  if (YES) return true;
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

async function main() {
  console.log(`[migrate-native-parts] connecting to ${url}`);
  const dry = (await convex.query(migrations.nativePartsDryRun, {})) as DryRunResult;
  console.log("\n[dry run]");
  console.log(`  messages:      ${dry.totalMessages} total`);
  console.log(`                 ${dry.messagesNeedingMigration} to migrate`);
  console.log(`                 ${dry.malformedMessages} malformed`);
  console.log(`  conversations: ${dry.totalConversations} total`);
  console.log(`                 ${dry.conversationsNeedingMigration} to migrate`);
  console.log(`                 ${dry.malformedConversations} malformed`);

  if (!APPLY) {
    console.log("\n[dry run] re-run with --apply to migrate");
    return;
  }

  if (dry.malformedMessages + dry.malformedConversations > 0) {
    const ok = await confirm(
      `\n[!] ${dry.malformedMessages + dry.malformedConversations} rows could not be parsed. They will be skipped (left as-is). Continue? [y/N] `
    );
    if (!ok) {
      console.log("aborting");
      return;
    }
  }

  let cursor: string | null = null;
  let totalMigrated = 0;
  while (true) {
    const result = (await convex.mutation(migrations.nativePartsMessagesBatch, {
      cursor: cursor ?? undefined,
    })) as BatchResult;
    totalMigrated += result.migrated;
    console.log(
      `[messages] scanned=${result.scanned} migrated=${result.migrated} malformed=${result.malformed} hasMore=${result.hasMore}`
    );
    if (!result.hasMore) break;
    cursor = result.cursor;
  }

  cursor = null;
  let totalConv = 0;
  while (true) {
    const result = (await convex.mutation(
      migrations.nativePartsConversationsBatch,
      { cursor: cursor ?? undefined }
    )) as BatchResult;
    totalConv += result.migrated;
    console.log(
      `[conversations] scanned=${result.scanned} migrated=${result.migrated} malformed=${result.malformed} hasMore=${result.hasMore}`
    );
    if (!result.hasMore) break;
    cursor = result.cursor;
  }

  console.log("\n[done]");
  console.log(`  messages migrated:      ${totalMigrated}`);
  console.log(`  conversations migrated: ${totalConv}`);

  const verify = (await convex.query(
    migrations.nativePartsDryRun,
    {}
  )) as DryRunResult;
  if (
    verify.messagesNeedingMigration === 0 &&
    verify.conversationsNeedingMigration === 0
  ) {
    console.log("[verify] no rows remaining to migrate ✓");
  } else {
    console.warn(
      `[verify] ${verify.messagesNeedingMigration + verify.conversationsNeedingMigration} rows remain — re-run --apply`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
