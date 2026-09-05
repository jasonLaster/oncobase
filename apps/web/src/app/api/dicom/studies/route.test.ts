import { expect, mock, test } from "bun:test";

const calls: Record<string, unknown>[] = [];
mock.module("@/lib/convex-server", () => ({ getConvexServerClient: () => ({
  query: async (_ref: unknown, args: Record<string, unknown>) => {
    calls.push(args);
    if (args.includeImages !== false) throw new Error("Full image inventory exceeds backend read budget");
    return [{ _id: "series", seriesKey: "fixture", label: "Fixture", relativeDirectory: "fixture", imageCount: 9, images: [] }];
  },
}) }));
mock.module("@/lib/dicom-local", () => ({ getDicomCatalog: async () => ({ root: "local", series: [] }) }));
const { GET } = await import("./route");

for (const query of ["", "?directory=fixture"]) {
  test(`DICOM catalog returns summaries without reading every image (${query || "unfiltered"})`, async () => {
    calls.length = 0;
    const response = await GET(new Request(`https://example.test/api/dicom/studies${query}`));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.root).toBe("vercel-blob");
    expect(body.series).toHaveLength(1);
    expect(body.series[0]).toMatchObject({ seriesKey: "fixture", imageCount: 9, images: [] });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.includeImages).toBe(false);
  });
}
