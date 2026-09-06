#!/usr/bin/env npx tsx
/**
 * Delete all Liveblocks rooms that have 0 comments (threads).
 *
 * Usage:
 *   npx tsx scripts/delete-empty-rooms.ts          # dry run
 *   npx tsx scripts/delete-empty-rooms.ts --delete  # actually delete
 */

import { Liveblocks } from "@liveblocks/node";

const secret = process.env.LIVEBLOCKS_SECRET_KEY ?? process.env.LIVEBLOCKS_API_KEY;
if (!secret) {
  console.error("Missing LIVEBLOCKS_SECRET_KEY or LIVEBLOCKS_API_KEY env var");
  process.exit(1);
}

const dryRun = !process.argv.includes("--delete");
const liveblocks = new Liveblocks({ secret });

async function main() {
  // 1. List all rooms
  const allRooms: Array<{ id: string }> = [];
  let cursor: string | null = null;

  do {
    const page = await liveblocks.getRooms({
      limit: 100,
      ...(cursor ? { startingAfter: cursor } : {}),
    });
    allRooms.push(...page.data.map((r) => ({ id: r.id })));
    cursor = page.nextCursor;
  } while (cursor);

  console.log(`Found ${allRooms.length} total rooms`);

  // 2. Check each room for threads
  const emptyRooms: string[] = [];

  for (const room of allRooms) {
    const { data: threads } = await liveblocks.getThreads({ roomId: room.id });
    if (threads.length === 0) {
      emptyRooms.push(room.id);
    }
  }

  console.log(`\n${emptyRooms.length} rooms with 0 comments:`);
  for (const id of emptyRooms) {
    console.log(`  - ${id}`);
  }

  if (emptyRooms.length === 0) {
    console.log("\nNothing to delete.");
    return;
  }

  // 3. Delete empty rooms
  if (dryRun) {
    console.log("\nDry run — pass --delete to actually delete these rooms.");
    return;
  }

  console.log(`\nDeleting ${emptyRooms.length} empty rooms...`);
  let deleted = 0;
  for (const id of emptyRooms) {
    try {
      await liveblocks.deleteRoom(id);
      deleted++;
      console.log(`  ✓ deleted ${id}`);
    } catch (err) {
      console.error(`  ✗ failed to delete ${id}:`, err);
    }
  }

  console.log(`\nDone. Deleted ${deleted}/${emptyRooms.length} rooms.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
