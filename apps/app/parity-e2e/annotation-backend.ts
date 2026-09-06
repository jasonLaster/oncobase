import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import type { Request } from "@playwright/test";
import { test as base, expect, signIn } from "./fixtures";
import { annotationRowCleanup } from "../scripts/parity-annotation-cleanup";

type SavedImage = { imageKey: string; imagePath: string; annotations: Array<{ text?: string }> };

// Temporary catalog records reference an existing blob. All browser requests,
// annotation persistence, reload and teardown use the real services, no routes.
export const test = base.extend<{
  annotationBackend: { seriesKey: string; read: () => Promise<SavedImage[]> };
}>({
  annotationBackend: [async ({ page, request }, use, info) => {
    const seriesKey = `playwright-parity-${randomUUID()}`;
    const journal = info.outputPath("backend-cleanup.json");
    const pending = new Set<Request>();
    const failed: string[] = [];
    const writes: string[] = [];
    const imageKeys = new Set([`${seriesKey}/fixture.dcm`]);
    const cleanupRows = annotationRowCleanup();
    const record = (state: string, extra = {}) => writeFile(journal, JSON.stringify({
      state, seriesKey, baseURL: info.project.use.baseURL, writes, ...extra,
    }, null, 2));
    await signIn(page);
    expect((await request.post("/api/login", { data: {
      password: process.env.WIKI_VITE_PREVIEW_LOGIN_PASSWORD,
    } })).ok()).toBe(true);
    const read = async (): Promise<SavedImage[]> => {
      const response = await request.get(`/api/dicom/annotations?seriesKey=${encodeURIComponent(seriesKey)}`);
      expect(response.ok(), "Real annotation read").toBe(true);
      const body = await response.json();
      expect(body.storage, "Unavailable storage must not masquerade as empty data").not.toBe("unavailable");
      expect(body.seriesKey).toBe(seriesKey);
      expect(Array.isArray(body.images)).toBe(true);
      return body.images;
    };
    expect(await read(), "Fresh test-owned namespace").toEqual([]);
    expect(await cleanupRows.read(seriesKey), "Cleanup credential preflight").toEqual([]);
    // Write ownership to disk BEFORE the first possible mutation. An interrupted
    // run can be reconciled by this exact series key, never a broad test prefix.
    await record("pending");
    const observe = (req: Request) => {
      if (new URL(req.url()).pathname !== "/api/dicom/annotations" || req.method() !== "PUT") return;
      const body = req.postDataJSON();
      writes.push(body.seriesKey);
      if (body.seriesKey !== seriesKey || !imageKeys.has(body.imageKey)) failed.push("Unexpected annotation ownership");
      pending.add(req);
    };
    page.on("request", observe);
    page.on("response", (response) => {
      // Both handlers await the database mutation before sending headers. The
      // UI does not consume the JSON body; its later cancellation is not a
      // failed save. Require the acknowledgement plus fresh persisted readback.
      if (pending.delete(response.request()) && !response.ok()) failed.push(`Annotation write returned ${response.status()}`);
    });
    page.on("requestfailed", (req) => {
      if (pending.delete(req)) failed.push("Annotation write completion is unknown");
    });
    try {
      await cleanupRows.seed(seriesKey, "4-10 biopsy/LASTERDIANAD (1)/SER00003/IMG00006.dcm");
      const response = await request.get(`/api/dicom/series?key=${encodeURIComponent(seriesKey)}`);
      expect(response.ok()).toBe(true);
      expect((await response.json()).images.map((image: { relativePath: string }) => image.relativePath)).toEqual([...imageKeys]);
      await use({ seriesKey, read });
    } finally {
      // Stop timers and new browser work, then drain already-started writes.
      // Cleanup uses an independent API context, not the closed page's session.
      // Observe save acknowledgements before closing the page.
      try { await expect.poll(() => pending.size, { timeout: 15_000 }).toBe(0); }
      catch { failed.push("Annotation writes still pending at teardown"); }
      await page.close({ runBeforeUnload: false }).catch(() => { failed.push("Browser closure failed"); });
      try {
        const saved = await read();
        for (const image of saved) {
          expect(imageKeys.has(image.imageKey), "Cleanup only known test images").toBe(true);
          expect(image.imagePath).toBe(image.imageKey);
          const response = await request.put("/api/dicom/annotations", { data: {
            seriesKey, imageKey: image.imageKey, imagePath: image.imagePath, annotations: [],
          } });
          expect(response.ok(), "Real annotation cleanup").toBe(true);
        }
        const remaining = await read();
        expect(remaining.every((image) => image.annotations.length === 0)).toBe(true);
        const deletedRowIds = await cleanupRows.removeEmpty(seriesKey, imageKeys, remaining.length);
        expect(await read(), "App read confirms complete removal").toEqual([]);
        await record(failed.length ? "cleanup-uncertain" : "clean", { deletedRowIds, failed });
        expect(failed, "Uncertain writes block the next phase").toEqual([]);
      } catch (error) {
        await record("cleanup-failed", { failed, error: String(error) });
        throw error;
      } finally {
        await info.attach("backend-cleanup", { path: journal, contentType: "application/json" });
      }
    }
  }, { timeout: 60_000 }],
});
