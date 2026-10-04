/**
 * Drives the 0007_native_parts migration end-to-end.
 *
 *   bun scripts/migrate-native-parts.ts                 # dry run
 *   bun scripts/migrate-native-parts.ts --apply         # actually migrate
 *   bun scripts/migrate-native-parts.ts --apply --yes   # skip prompt
 *
 * Drives the internal `migrations:*` functions through `bunx convex run`;
 * pass --prod / --deployment-name / --env-file to choose the deployment.
 *
 * See apps/app/specs/chat-performance-plan.md Phase 2.
 */

import { internal } from "../convex/_generated/api";
import * as readline from "node:readline";
import type { FunctionReturnType } from "convex/server";
import { convexRun, splitDeploymentFlags } from "./admin/convex-run";

const { deployment, rest } = splitDeploymentFlags(process.argv.slice(2));
const args = new Set(rest);
const migrations = internal.migrations;
type BatchResult = FunctionReturnType<typeof migrations.nativePartsMessagesBatch>;
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
  console.log(`[migrate-native-parts] convex run ${deployment.join(" ") || "(default deployment)"}`);
  const dry = convexRun(migrations.nativePartsDryRun, {}, deployment);
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
    const result: BatchResult = convexRun(migrations.nativePartsMessagesBatch, {
      cursor: cursor ?? undefined,
    }, deployment);
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
    const result: BatchResult = convexRun(
      migrations.nativePartsConversationsBatch,
      { cursor: cursor ?? undefined },
      deployment,
    );
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

  const verify = convexRun(migrations.nativePartsDryRun, {}, deployment);
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
