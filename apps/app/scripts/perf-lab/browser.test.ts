import { expect, test } from "bun:test";
import { bytesBy, type Request } from "./browser";

const request = (overrides: Partial<Request>): Request => ({ path: "/x", type: "Fetch", status: 200, bytes: 0, cached: false, aborted: false, start: 0, end: Number.NaN, chunks: [], ...overrides });

test("bytesBy counts a finished request in full, headers included", () => {
  expect(bytesBy(request({ bytes: 1200, end: 50, chunks: [[20, 500], [40, 500]] }), 60)).toBe(1200);
});

test("bytesBy counts only the chunks received by the cutoff for a request still in flight", () => {
  const r = request({ bytes: 1000, end: 90, chunks: [[20, 500], [40, 300], [80, 200]] });
  expect(bytesBy(r, 50)).toBe(800);
  expect(bytesBy(r, 10)).toBe(0);
});

test("bytesBy keeps the body of a request the app aborted after reading it", () => {
  expect(bytesBy(request({ bytes: 3000, aborted: true, end: 70, chunks: [[30, 1000], [60, 2000]] }), 100)).toBe(3000);
});
