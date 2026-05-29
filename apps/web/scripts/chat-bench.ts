/**
 * Chat backend bench. Hits /api/chat with a fixed prompt and records
 * time-to-first-byte and bytes/sec for the route alone.
 *
 *   bun scripts/chat-bench.ts --baseline           # writes apps/web/e2e/.perf/baseline.json
 *   bun scripts/chat-bench.ts --compare            # diffs against baseline.json
 *   bun scripts/chat-bench.ts --url http://...     # custom base URL
 *
 * Requires AI Gateway + Convex env so the /api/chat route can serve.
 * See apps/web/specs/chat-performance-testing.md.
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

interface BenchResult {
  url: string;
  prompt: string;
  status: number;
  ttfbMs: number;
  totalMs: number;
  bytes: number;
  bytesPerSec: number;
  tokensApprox: number;
  tokensPerSec: number;
  capturedAt: string;
}

const args = new Set(process.argv.slice(2));
const baseUrl = process.env.CHAT_BENCH_URL || "http://localhost:3000";
const prompt =
  process.env.CHAT_BENCH_PROMPT ||
  "What is the treatment plan? Answer in 2 short sentences.";
const password = process.env.CHAT_BENCH_PASSWORD || "diana";

const PERF_DIR = join(import.meta.dir, "..", "e2e", ".perf");
const BASELINE_PATH = join(PERF_DIR, "baseline.json");

async function login(): Promise<string | null> {
  const res = await fetch(`${baseUrl}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) return null;
  return res.headers.get("set-cookie") ?? null;
}

async function runBench(cookie: string | null): Promise<BenchResult> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (cookie) headers.cookie = cookie;

  const start = performance.now();
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      messages: [
        {
          id: "bench-1",
          role: "user",
          parts: [{ type: "text", text: prompt }],
        },
      ],
    }),
  });

  if (!res.body) {
    return {
      url: baseUrl,
      prompt,
      status: res.status,
      ttfbMs: 0,
      totalMs: 0,
      bytes: 0,
      bytesPerSec: 0,
      tokensApprox: 0,
      tokensPerSec: 0,
      capturedAt: new Date().toISOString(),
    };
  }

  const reader = res.body.getReader();
  let bytes = 0;
  let firstByteT: number | null = null;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (firstByteT === null) firstByteT = performance.now();
    bytes += value.byteLength;
  }
  const end = performance.now();
  const ttfbMs = (firstByteT ?? end) - start;
  const totalMs = end - start;
  const seconds = totalMs / 1000;
  const tokensApprox = Math.round(bytes / 4);

  return {
    url: baseUrl,
    prompt,
    status: res.status,
    ttfbMs: Math.round(ttfbMs),
    totalMs: Math.round(totalMs),
    bytes,
    bytesPerSec: Math.round(bytes / seconds),
    tokensApprox,
    tokensPerSec: Math.round(tokensApprox / seconds),
    capturedAt: new Date().toISOString(),
  };
}

async function main() {
  const cookie = await login();
  if (!cookie) {
    console.error(
      "Login failed. Set CHAT_BENCH_PASSWORD or ensure dev server is running."
    );
    process.exit(1);
  }

  // Warm-up run — connection / cache effects make the first call noisy.
  await runBench(cookie);

  // Take 3 samples and median ttfb / total.
  const runs: BenchResult[] = [];
  for (let i = 0; i < 3; i++) {
    runs.push(await runBench(cookie));
  }
  runs.sort((a, b) => a.ttfbMs - b.ttfbMs);
  const median = runs[1];

  console.log("\n[chat-bench] median of 3");
  console.log(`  url:           ${median.url}`);
  console.log(`  status:        ${median.status}`);
  console.log(`  ttfb:          ${median.ttfbMs}ms`);
  console.log(`  total:         ${median.totalMs}ms`);
  console.log(`  bytes:         ${median.bytes}`);
  console.log(`  bytes/s:       ${median.bytesPerSec}`);
  console.log(`  tokens (~):    ${median.tokensApprox}`);
  console.log(`  tokens/s (~):  ${median.tokensPerSec}\n`);

  if (args.has("--baseline")) {
    mkdirSync(dirname(BASELINE_PATH), { recursive: true });
    writeFileSync(BASELINE_PATH, JSON.stringify(median, null, 2));
    console.log(`[chat-bench] wrote ${BASELINE_PATH}`);
  } else if (args.has("--compare")) {
    if (!existsSync(BASELINE_PATH)) {
      console.error(`[chat-bench] no baseline at ${BASELINE_PATH}`);
      process.exit(1);
    }
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as BenchResult;
    const ttfbDelta = ((median.ttfbMs - baseline.ttfbMs) / baseline.ttfbMs) * 100;
    const bpsDelta = ((median.bytesPerSec - baseline.bytesPerSec) / baseline.bytesPerSec) * 100;
    console.log(`[chat-bench] vs baseline (${baseline.capturedAt})`);
    console.log(`  ttfb:    ${ttfbDelta >= 0 ? "+" : ""}${ttfbDelta.toFixed(1)}%`);
    console.log(`  bytes/s: ${bpsDelta >= 0 ? "+" : ""}${bpsDelta.toFixed(1)}%`);
    if (ttfbDelta > 10) {
      console.error("[chat-bench] FAIL: ttfb regressed >10%");
      process.exit(1);
    }
    if (bpsDelta < -10) {
      console.error("[chat-bench] FAIL: bytes/s dropped >10%");
      process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
