import { describe, expect, test } from "bun:test";
import {
  buildElicitRequest,
  formatElicitMarkdown,
  parseElicitArgs,
  searchElicit,
  type ElicitPaper,
} from "./elicit";

describe("elicit cli", () => {
  test("parses a filtered paper query", () => {
    const options = parseElicitArgs([
      "papers",
      "triple-negative breast cancer immunotherapy",
      "--max-results",
      "25",
      "--min-year",
      "2020",
      "--type-tag",
      "RCT,Meta-Analysis",
      "--has-pdf",
    ]);

    expect(options.kind).toBe("papers");
    expect(options.query).toBe("triple-negative breast cancer immunotherapy");
    expect(buildElicitRequest(options)).toEqual({
      query: "triple-negative breast cancer immunotherapy",
      searchMode: "semantic",
      maxResults: 25,
      corpus: "elicit",
      filters: {
        minYear: 2020,
        typeTags: ["RCT", "Meta-Analysis"],
        hasPdf: true,
      },
    });
  });

  test("parses clinical trial filters", () => {
    const options = parseElicitArgs([
      "trials",
      "TNBC antibody drug conjugate",
      "--phase",
      "PHASE2,PHASE3",
      "--status",
      "RECRUITING",
      "--has-results",
    ]);

    expect(buildElicitRequest(options)).toEqual({
      query: "TNBC antibody drug conjugate",
      searchMode: "semantic",
      maxResults: 10,
      trialFilters: {
        phase: ["PHASE2", "PHASE3"],
        recruitmentStatus: ["RECRUITING"],
        hasResults: true,
      },
    });
  });

  test("rejects filters in keyword mode", () => {
    expect(() =>
      parseElicitArgs([
        "papers",
        "TNBC",
        "--search-mode",
        "keyword",
        "--min-year",
        "2024",
      ]),
    ).toThrow("does not allow filter options");
  });

  test("sends bearer authentication without putting it in the output", async () => {
    const options = parseElicitArgs(["papers", "TNBC", "--max-results", "1"]);
    let authorization = "";
    const paper: ElicitPaper = {
      elicitId: "paper-1",
      title: "A paper",
      authors: ["A. Author"],
      year: 2026,
      abstract: "An abstract.",
      doi: "10.1000/example",
      pmid: "123",
      venue: "Example Journal",
      citedByCount: 4,
      urls: [],
      studyTypeTags: ["RCT"],
      journalQuartile: 1,
      fullTextUrl: null,
    };
    const envelope = await searchElicit(options, "test-secret", {
      baseUrl: "https://example.test/api/v2",
      now: () => new Date("2026-09-01T12:00:00.000Z"),
      fetch: (async (_url, init) => {
        authorization = new Headers(init?.headers).get("Authorization") ?? "";
        return new Response(JSON.stringify({ papers: [paper], warnings: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }) as typeof fetch,
    });

    expect(authorization).toBe("Bearer test-secret");
    expect(JSON.stringify(envelope)).not.toContain("test-secret");
    expect(envelope.endpoint).toBe("https://example.test/api/v2/search/papers");
    expect(formatElicitMarkdown(envelope)).toContain(
      "[PubMed](https://pubmed.ncbi.nlm.nih.gov/123/)",
    );
    expect(formatElicitMarkdown(envelope)).toContain(
      "Verify decision-relevant claims against the linked primary sources",
    );
  });

  test("reports structured API errors", async () => {
    const options = parseElicitArgs(["papers", "TNBC"]);
    await expect(
      searchElicit(options, "test-secret", {
        fetch: (async () =>
          new Response(
            JSON.stringify({
              error: { code: "insufficient_quota", message: "Quota exhausted" },
            }),
            { status: 402 },
          )) as unknown as typeof fetch,
      }),
    ).rejects.toThrow("Elicit request failed (402): insufficient_quota: Quota exhausted");
  });
});
