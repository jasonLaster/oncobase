// Stylesheet regression fixtures only. Real theme switching/modal events and PNGs
// are covered by the separate current-content image-proportions.spec.ts.
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repo = resolve(import.meta.dirname, '../../..');
const styles = [
  'packages/wiki-markdown/src/styles.css',
  'packages/education/src/styles.css',
].map(path => readFileSync(resolve(repo, path), 'utf8')).join('\n');
const shapes = [
  { id: 'portrait', width: 600, height: 1560 },
  { id: 'landscape', width: 1200, height: 800 },
  { id: 'square', width: 900, height: 900 },
];
function svgSource(width: number, height: number) {
  // Native intrinsic dimensions and viewBox agree. No image CSS is embedded.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#d8e7ef"/><circle cx="${width / 2}" cy="${height / 2}" r="${Math.min(width, height) / 4}" fill="#6d8595"/></svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}
function fixture(theme: string) {
  const source = svgSource(600, 1560);
  const raw = shapes.map(shape => `<figure id="${shape.id}"><img alt="${shape.id}" src="${svgSource(shape.width, shape.height)}" width="${shape.width}" height="${shape.height}"><figcaption>${shape.id} caption</figcaption></figure>`).join('');
  return `<!doctype html><html class="${theme === 'dark' ? 'dark' : ''}"><head><style>${styles}</style><style>body{margin:0}.fixture-column{width:calc(100vw - 78px);max-width:820px;margin:0 auto}.fixture-column figure{margin-left:0;margin-right:0}</style></head><body><main class="fixture-column edu-article"><div class="wiki-markdown">
    ${raw}
    <button id="react-explicit" class="wiki-theater-image-button" style="aspect-ratio:600 / 1560"><img class="wiki-theater-image" alt="explicit React preview" width="600" height="1560" src="${source}"></button>
    <button id="react-fallback" class="wiki-theater-image-button" style="aspect-ratio:16 / 9"><img class="wiki-theater-image" alt="dimensionless React preview" src="${source}"></button>
    <figure class="wiki-slides-viewer"><div class="wiki-slides-viewer__stage"><ol class="wiki-slides-viewer__slides"><li id="slide" class="wiki-slides-viewer__slide"><button class="wiki-slides-viewer__image-button"><img alt="contained slide" src="${source}"></button></li></ol></div></figure>
  </div></main></body></html>`;
}

for (const width of [390, 1280]) for (const theme of ['light', 'dark']) {
  test(`static SVGs and framed images keep their sizing at ${width}px/${theme}`, async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width, height: 844 }, colorScheme: null });
    try {
      const page = await context.newPage();
      await page.setContent(fixture(theme));
      const measured = await page.locator('main img').evaluateAll(async elements => Promise.all(elements.map(async element => {
        const image = element as HTMLImageElement;
        image.loading = 'eager';
        await image.decode();
        const box = image.getBoundingClientRect();
        const parent = image.parentElement!.getBoundingClientRect();
        const caption = image.parentElement!.querySelector('figcaption')?.getBoundingClientRect();
        return { id: image.parentElement!.id || 'slide-image', width: box.width, height: box.height,
          naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight,
          objectFit: getComputedStyle(image).objectFit, parentWidth: parent.width, parentHeight: parent.height,
          captionGap: caption ? caption.top - box.bottom : null };
      })));
      expect(measured).toHaveLength(6);
      for (const shape of shapes) {
        const image = measured.find(image => image.id === shape.id)!;
        expect([image.naturalWidth, image.naturalHeight]).toEqual([shape.width, shape.height]);
        expect(image.width).toBeGreaterThan(0);
        expect(image.width).toBeLessThanOrEqual(Math.min(shape.width, width - 78, 820) + 1);
        expect(Math.abs(image.height - image.width * shape.height / shape.width), shape.id).toBeLessThan(1);
        expect(image.captionGap!, shape.id + ' caption overlap').toBeGreaterThanOrEqual(-1);
      }
      const explicit = measured.find(image => image.id === 'react-explicit')!;
      expect(Math.abs(explicit.parentHeight - explicit.parentWidth * 1560 / 600)).toBeLessThan(1);
      const fallback = measured.find(image => image.id === 'react-fallback')!;
      // This preview intentionally reserves 16:9 and contains the portrait; its
      // element box is not required to share the portrait's natural ratio.
      expect(Math.abs(fallback.parentHeight - fallback.parentWidth * 9 / 16)).toBeLessThan(1);
      for (const image of [explicit, fallback, measured.find(image => image.id === 'slide-image')!]) {
        expect(image.objectFit).toBe('contain');
        expect(Math.abs(image.width - image.parentWidth)).toBeLessThan(1);
        expect(Math.abs(image.height - image.parentHeight)).toBeLessThan(1);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally {
      await context.close();
    }
  });
}
