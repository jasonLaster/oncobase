import "./load-env";

import { ConvexHttpClient } from "convex/browser";

import { api } from "../convex/_generated/api";
import { resolveServerConvexUrl } from "../src/lib/convex-url";
import { diagnosticTimelineSeed } from "./fixtures/diagnostic-timeline-seed";

const SITE_SLUG = process.env.DIAGNOSTIC_TIMELINE_SITE_SLUG ?? "diana";
const TIMELINE_META_KEY = "diagnosticTimeline:data";

const convexUrl = resolveServerConvexUrl();
if (!convexUrl) {
  throw new Error("NEXT_PUBLIC_CONVEX_URL or CONVEX_URL is required.");
}

const convex = new ConvexHttpClient(convexUrl);

async function main() {
  await convex.mutation(api.documents.setMeta, {
    key: TIMELINE_META_KEY,
    siteSlug: SITE_SLUG,
    value: JSON.stringify(diagnosticTimelineSeed),
  });

  const eventCount = diagnosticTimelineSeed.sleeves.reduce(
    (total, sleeve) =>
      total +
      sleeve.tracks.reduce((trackTotal, track) => trackTotal + track.events.length, 0),
    0,
  );

  console.log(
    `Seeded diagnostic timeline for site=${SITE_SLUG} with ${eventCount} events.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
