/**
 * Regenerates the responsive public-page images from the original artwork in `image-sources/`.
 *
 *   bun --cwd apps/app images:optimize
 *
 * Originals live in `image-sources/`, which is never imported or copied into the build. This script
 * writes AVIF and WebP variants at the widths below into `src/assets/images/` together with the
 * generated `src/assets/images/index.ts`, which imports them so Vite fingerprints them under
 * `/assets/` (served with a one-year immutable cache). The outputs are committed, so the Vercel
 * build never needs the encoder. `sharp` comes from the workspace (Next.js installs it for
 * apps/oncoguide); it is not a dependency of this app.
 *
 * To add an illustration:
 * 1. Put the original at full resolution in `image-sources/` as `<name>-light.<ext>` and
 *    `<name>-dark.<ext>` (or `<name>.<ext>` for one that does not follow the theme).
 * 2. Add an entry to `IMAGES` with the widths it needs: measure how wide it is displayed at
 *    390, 768 and 1440 px viewports, and cover 1× and 2× of those (the largest width should not
 *    exceed the original).
 * 3. Run the command above, render it with `<ResponsiveImage image={images["<name>"]} sizes="…" />`
 *    from `src/pages/LandingShowcase.tsx`, and compare crops against the original at 100%.
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

type Theme = "light" | "dark";

type ImageSpec = {
  /** Base name of the file(s) in `image-sources/`. */
  name: string;
  /** Source extension in `image-sources/`. */
  source: "webp" | "jpg" | "png";
  themes: readonly Theme[] | null;
  widths: readonly number[];
  /** Line art keeps full-resolution colour; screenshots of text do too. */
  avifQuality: number;
  webpQuality: number;
};

const ILLUSTRATION = { source: "webp", themes: ["light", "dark"], widths: [480, 768, 1152], avifQuality: 65, webpQuality: 82 } as const;
const SCREENSHOT = { source: "jpg", avifQuality: 62, webpQuality: 80 } as const;

const IMAGES: ImageSpec[] = [
  // Landing education cartoons (1536×1024 originals). Displayed at 292 px (phone), 221–546 px (tablet and desktop).
  { name: "immune-recognition", ...ILLUSTRATION },
  { name: "cell-therapy-family", ...ILLUSTRATION },
  { name: "omics-layers", ...ILLUSTRATION },
  { name: "ctdna-mailroom", ...ILLUSTRATION },
  { name: "parp-synthetic-lethality", ...ILLUSTRATION },
  // Landing hero laptop screenshot (1800×1197). Displayed at 313 px (phone), 677 px (tablet), 931 px (desktop).
  { name: "reader-desktop", ...SCREENSHOT, themes: ["light", "dark"], widths: [640, 960, 1400, 1800] },
  // Landing hero phone screenshot (600×1301). Displayed at 99 px (phone) and 198 px (desktop).
  { name: "reader-mobile", ...SCREENSHOT, themes: ["light", "dark"], widths: [240, 420, 600] },
  // Features page cards (1192×640). Displayed at 356 px (phone) and 544 px (desktop).
  { name: "diagnostics-timeline", ...SCREENSHOT, themes: ["light", "dark"], widths: [600, 1192] },
  { name: "dicom-viewer", ...SCREENSHOT, themes: null, widths: [600, 1192] },
  // Sign-in page cartoon (900×900 with alpha; also served as public/auth-wiki-cartoon-*.png below). Displayed at 129 px (phone), 260 px (tablet), 460 px (desktop).
  { name: "sign-in-cartoon", source: "png", themes: ["light", "dark"], widths: [320, 560, 900], avifQuality: 65, webpQuality: 82 },
];

/**
 * Files that must keep a fixed public URL because code outside this app's pages builds the path:
 * `packages/wiki-shell` (the reader's sign-in dialog) and `ThemeCompare` on the features page.
 * They are re-encoded in place, so they still revalidate on each visit but are much smaller. The
 * dialog shows the cartoon at most 290 CSS px wide, so 600 px covers 2× screens; the PNG stays lossless.
 */
const FIXED_PUBLIC: { source: string; output: string; width: number; format: "png" | "webp" }[] = [
  ...(["light", "dark"] as const).flatMap((theme) => [
    { source: `sign-in-cartoon-${theme}.png`, output: `auth-wiki-cartoon-${theme}.png`, width: 600, format: "png" as const },
    { source: `immune-recognition-${theme}.webp`, output: `landing/immune-recognition-${theme}.webp`, width: 1152, format: "webp" as const },
  ]),
];

const appRoot = path.resolve(import.meta.dir, "..");
const sourceDirectory = path.join(appRoot, "image-sources");
const outputDirectory = path.join(appRoot, "src/assets/images");
const publicDirectory = path.join(appRoot, "public");

function identifier(...parts: (string | number)[]) {
  return parts
    .join("-")
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map((part, index) => (index === 0 ? part : part[0]!.toUpperCase() + part.slice(1)))
    .join("");
}

async function main() {
  rmSync(outputDirectory, { recursive: true, force: true });
  mkdirSync(outputDirectory, { recursive: true });
  const imports: string[] = [];
  const entries: string[] = [];
  const report: string[] = [];

  for (const spec of IMAGES) {
    const variants: string[] = [];
    let size = { width: 0, height: 0 };
    for (const theme of spec.themes ?? [null]) {
      const file = theme ? `${spec.name}-${theme}` : spec.name;
      const input = path.join(sourceDirectory, `${file}.${spec.source}`);
      const original = await sharp(input).metadata();
      const sets: Record<"avif" | "webp", string[]> = { avif: [], webp: [] };
      for (const width of spec.widths) {
        if (width > original.width) throw new Error(`${file}: ${width}w is wider than the ${original.width}px original`);
        const resized = sharp(input).resize({ width, kernel: "lanczos3" });
        const avif = await resized.clone().avif({ quality: spec.avifQuality, effort: 6, chromaSubsampling: "4:4:4" }).toBuffer({ resolveWithObject: true });
        const webp = await resized.clone().webp({ quality: spec.webpQuality, effort: 6, smartSubsample: true, alphaQuality: 90 }).toBuffer();
        for (const [format, data] of [["avif", avif.data], ["webp", webp]] as const) {
          const name = `${file}-${width}.${format}`;
          writeFileSync(path.join(outputDirectory, name), data);
          const id = identifier(file, width, format);
          imports.push(`import ${id} from "./${name}";`);
          sets[format].push(`\${${id}} ${width}w`);
          report.push(`${name.padEnd(42)} ${(data.length / 1024).toFixed(1).padStart(7)} KB`);
        }
        size = { width, height: avif.info.height };
      }
      const fallback = identifier(file, spec.widths[Math.min(1, spec.widths.length - 1)]!, "webp");
      variants.push(`    ${theme ?? "light"}: { avif: \`${sets.avif.join(", ")}\`, webp: \`${sets.webp.join(", ")}\`, fallback: ${fallback} },`);
    }
    entries.push(`  "${spec.name}": {\n    width: ${size.width},\n    height: ${size.height},\n${variants.join("\n")}\n  },`);
  }

  for (const fixed of FIXED_PUBLIC) {
    const resized = sharp(path.join(sourceDirectory, fixed.source)).resize({ width: fixed.width, kernel: "lanczos3" });
    const data =
      fixed.format === "png"
        ? await resized.png({ compressionLevel: 9, effort: 10 }).toBuffer()
        : await resized.webp({ quality: 82, effort: 6, smartSubsample: true }).toBuffer();
    writeFileSync(path.join(publicDirectory, fixed.output), data);
    report.push(`public/${fixed.output.padEnd(35)} ${(data.length / 1024).toFixed(1).padStart(7)} KB`);
  }

  const manifest = `// Generated by scripts/optimize-images.ts from image-sources/. Do not edit; rerun \`bun run images:optimize\`.
import type { ResponsiveImageSet } from "./types";
${imports.join("\n")}

export const images = {
${entries.join("\n")}
} satisfies Record<string, ResponsiveImageSet>;
`;
  writeFileSync(path.join(outputDirectory, "index.ts"), manifest);
  writeFileSync(
    path.join(outputDirectory, "types.ts"),
    `// Generated by scripts/optimize-images.ts. Do not edit.
export type ResponsiveImageVariant = {
  /** \`srcset\` of AVIF candidates. */
  avif: string;
  /** \`srcset\` of WebP candidates. */
  webp: string;
  /** \`src\` for browsers without \`<picture>\` support. */
  fallback: string;
};

export type ResponsiveImageSet = {
  /** Intrinsic size of the largest variant, for the \`width\`/\`height\` attributes. */
  width: number;
  height: number;
  light: ResponsiveImageVariant;
  dark?: ResponsiveImageVariant;
};
`,
  );
  console.log(report.join("\n"));
  console.log(`${readdirSync(outputDirectory).length} files in ${path.relative(appRoot, outputDirectory)}`);
}

await main();
