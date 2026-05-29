import crypto from "crypto";
import fs from "fs";
import path from "path";
import {
  renderWikiMarkdownHtml,
  renderWikiMarkdownHtmlAsync,
} from "@diana-tnbc/wiki-markdown/server";
import { applyPiiRedactions } from "@/lib/pii-redaction";
import { MARKDOWN_RENDER_CACHE_VERSION } from "@/lib/wiki-cache-tags";

const CACHE_DIR = path.join(process.cwd(), ".next", "cache", "markdown");

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function hashKey(md: string): string {
  const deploymentScope =
    process.env.VERCEL_DEPLOYMENT_ID ??
    process.env.VERCEL_GIT_COMMIT_SHA ??
    "local";
  return crypto
    .createHash("sha256")
    .update(`v${MARKDOWN_RENDER_CACHE_VERSION}:${deploymentScope}:${md}`)
    .digest("hex")
    .slice(0, 16);
}

export function renderMarkdown(md: string, currentSlug?: string): string {
  const redactedMd = applyPiiRedactions(md);
  const key = hashKey(`${currentSlug ?? ""}:${redactedMd}`);
  const cachePath = path.join(CACHE_DIR, `${key}.html`);

  try {
    return fs.readFileSync(cachePath, "utf-8");
  } catch {
    // Cache miss; render and store.
  }

  const html = renderWikiMarkdownHtml(redactedMd, currentSlug);

  try {
    ensureCacheDir();
    fs.writeFileSync(cachePath, html);
  } catch {
    // Non-fatal; cache write failure should not break rendering.
  }

  return html;
}

export async function renderMarkdownAsync(md: string, currentSlug?: string): Promise<string> {
  const t0 = performance.now();
  const redactedMd = applyPiiRedactions(md);
  const key = hashKey(`${currentSlug ?? ""}:${redactedMd}`);
  const cachePath = path.join(CACHE_DIR, `${key}.html`);

  try {
    const cached = await fs.promises.readFile(cachePath, "utf-8");
    console.log(
      `[perf] renderMarkdown cache-hit slug=${currentSlug} ${(performance.now() - t0).toFixed(1)}ms`,
    );
    return cached;
  } catch {
    // Cache miss; render and store.
  }

  const html = await renderWikiMarkdownHtmlAsync(redactedMd, currentSlug);

  console.log(
    `[perf] renderMarkdown cache-miss slug=${currentSlug} total=${(performance.now() - t0).toFixed(1)}ms`,
  );

  try {
    ensureCacheDir();
    await fs.promises.writeFile(cachePath, html);
  } catch {
    // Non-fatal; cache write failure should not break rendering.
  }

  return html;
}
