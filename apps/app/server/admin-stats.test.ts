import { expect, test } from "bun:test";
import { callKey, summarizeContent } from "./admin-stats";

test("call pages group into calls by stripping their variant suffix", () => {
  expect(callKey("sources/meeting-notes/04-06---scott-call-raw")).toBe("04-06---scott-call");
  expect(callKey("sources/meeting-notes/04-06---ucsf-complex-conception-avs")).toBe("04-06---ucsf-complex-conception");
  expect(callKey("sources/meeting-notes/03-19---stanford-med-onc")).toBe("03-19---stanford-med-onc");
});

test("content summary counts calls, emails, redactions and folders", () => {
  const pages = [
    { slug: "sources/meeting-notes/04-06---scott-call-raw", sensitive: true },
    { slug: "sources/meeting-notes/04-06---scott-call-formatted" },
    { slug: "sources/meeting-notes/04-06---scott-call-overview" },
    { slug: "sources/meeting-notes/05-01---intro" },
    { slug: "sources/emails/03-30-tissue-sample", sensitive: true },
    { slug: "sources/emails/04-02-referral" },
    { slug: "sources/research/papers/a" },
    { slug: "wiki/education/what-is-tnbc" },
    { slug: "wiki/treatment/plan" },
    { slug: "wiki/index" },
    { slug: "about/team" },
  ];
  const stats = summarizeContent(pages, [
    { slug: "sources/meeting-notes/04-06---scott-call-raw", sensitive: true, redactions: 2 },
    { slug: "sources/meeting-notes/04-06---scott-call-formatted", sensitive: false, redactions: 1 },
    { slug: "sources/meeting-notes/05-01---intro", sensitive: false, redactions: 0 },
    // Not in the listing (e.g. deleted between the two reads): ignored.
    { slug: "sources/meeting-notes/06-01---unlisted-raw", sensitive: false, redactions: 4 },
    { slug: "sources/emails/03-30-tissue-sample", sensitive: true, redactions: 1 },
  ]);
  expect(stats.totals).toEqual({ pages: 11, restricted: 2 });
  expect(stats.calls).toEqual({
    calls: 2, transcripts: 1, formatted: 1, overviews: 1, pages: 4, restricted: 1, redacted: 1, redactionBlocks: 3,
    byMonth: [{ month: "04", count: 1 }, { month: "05", count: 1 }],
  });
  expect(stats.emails).toEqual({ emails: 2, restricted: 1, redacted: 1, redactionBlocks: 1, byMonth: [{ month: "03", count: 1 }, { month: "04", count: 1 }] });
  expect(stats.sources.pages).toBe(7);
  expect(stats.sources.folders.map((f) => [f.folder, f.pages, f.restricted])).toEqual([["meeting-notes", 4, 1], ["emails", 2, 1], ["research", 1, 0]]);
  expect(stats.wiki.folders.map((f) => f.folder)).toEqual(["(top level)", "education", "treatment"]);
  expect(stats.education.pages).toBe(1);
  expect(stats.other).toEqual([{ folder: "about", pages: 1, restricted: 0 }]);
});
