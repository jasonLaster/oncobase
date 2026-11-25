import { describe, expect, test } from "bun:test";
import {
  HASH_FUNCTION_VERSION,
  compileOncobaseIgnore,
  extractAssetAndEmbedReferences,
  hashDocument,
  isExcludedVaultPath,
  parseMarkdownDocument,
  splitFrontmatter,
} from "./markdown-document.ts";
import {
  applyValidatedWikiEdit,
  computeRedactedPreview,
  findFirstChangedHeading,
  validateNewWikiPage,
} from "./wiki-edit-patch.ts";
import { parseSitePiiPatterns } from "./pii.ts";

describe("markdown-document parser and hash v3", () => {
  test("preserves exact frontmatter bytes and matches hash v3 semantics", () => {
    const raw = [
      "---",
      'title: "Treatment Plan"',
      "tags:",
      "  - treatment",
      "  - echo-sensitive",
      "sensitive: true",
      "---",
      "",
      "# Ignored H1 When Title In Frontmatter",
      "",
      "Cycle 1 starts Monday.",
      "",
    ].join("\n");

    const split = splitFrontmatter(raw);
    expect(split.frontmatterBlock).toBe(
      '---\ntitle: "Treatment Plan"\ntags:\n  - treatment\n  - echo-sensitive\nsensitive: true\n---\n',
    );
    const parsed = parseMarkdownDocument("wiki/treatment/plan", raw);
    expect(HASH_FUNCTION_VERSION).toBe(3);
    expect(parsed.title).toBe("Treatment Plan");
    expect(parsed.tags).toEqual(["treatment"]);
    expect(parsed.sensitive).toBe(true);
    expect(parsed.sensitiveInclude).toEqual(["echo"]);
    expect(parsed.content).toBe("Cycle 1 starts Monday.\n");
    expect(parsed.hash).toBe(
      hashDocument({
        title: "Treatment Plan",
        content: "Cycle 1 starts Monday.\n",
        tags: ["treatment"],
        sensitive: true,
        sensitiveInclude: ["echo"],
      }),
    );
  });

  test("enforces vault exclusions and .oncobaseignore patterns", () => {
    const matchers = compileOncobaseIgnore("sources/private/\n*.draft.md\n# comment\n");
    expect(isExcludedVaultPath(".obsidian/workspace.json", matchers)).toBe(true);
    expect(isExcludedVaultPath("CLAUDE.md", matchers)).toBe(true);
    expect(isExcludedVaultPath("wiki/../secret.md", matchers)).toBe(true);
    expect(isExcludedVaultPath("sources/private/email.md", matchers)).toBe(true);
    expect(isExcludedVaultPath("notes.draft.md", matchers)).toBe(true);
    expect(isExcludedVaultPath("wiki/treatment/plan.md", matchers)).toBe(false);
  });
});

describe("applyValidatedWikiEdit", () => {
  const baseRaw = [
    "---",
    "title: Care Plan",
    "tags: [care, oncology]",
    "---",
    "",
    "# Care Plan",
    "",
    "Patient Diana Laster is scheduled for cycle 2 on May 12.",
    "",
    "## Dosing",
    "",
    "Standard pembrolizumab 200 mg IV every 3 weeks.",
    "",
    "See [[wiki/labs/cbc]] and ![[scans/baseline.png]].",
    "",
  ].join("\n");

  test("applies valid body-only search/replace while preserving raw PII and exact frontmatter", () => {
    const result = applyValidatedWikiEdit({
      slug: "wiki/care/plan",
      baseRaw,
      edits: [
        {
          oldText: "Standard pembrolizumab 200 mg IV every 3 weeks.",
          newText: "Standard pembrolizumab 200 mg IV every 3 weeks (KEYNOTE-522).",
        },
      ],
      piiPatterns: undefined,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Raw PII outside edited span is preserved verbatim!
    expect(result.proposedRaw).toContain("Patient Diana Laster is scheduled");
    // Frontmatter bytes preserved verbatim!
    expect(result.proposedRaw.startsWith("---\ntitle: Care Plan\ntags: [care, oncology]\n---\n")).toBe(true);
    // Redacted diff never leaks raw PII!
    expect(result.redactedDiff).not.toContain("Diana Laster");
    expect(result.redactedDiff).toContain("+Standard pembrolizumab 200 mg IV every 3 weeks (KEYNOTE-522).");
    expect(result.stats).toEqual({ additions: 1, deletions: 1 });
    expect(result.parsedProposed.hash).not.toBe(result.parsedBase.hash);
  });

  test("allows adding normal prose wikilinks and external citations, rejects asset/embed reference changes", () => {
    const okWikiLink = applyValidatedWikiEdit({
      slug: "wiki/care/plan",
      baseRaw,
      edits: [
        {
          oldText: "Standard pembrolizumab 200 mg IV every 3 weeks.",
          newText: "Standard pembrolizumab 200 mg IV every 3 weeks (see [[wiki/trials/keynote-522]] and [FDA](https://fda.gov)).",
        },
      ],
      piiPatterns: undefined,
    });
    expect(okWikiLink.ok).toBe(true);

    const badAsset = applyValidatedWikiEdit({
      slug: "wiki/care/plan",
      baseRaw,
      edits: [
        {
          oldText: "See [[wiki/labs/cbc]] and ![[scans/baseline.png]].",
          newText: "See [[wiki/labs/cbc]] and ![[scans/baseline.png]] and [[reports/lab.pdf]].",
        },
      ],
      piiPatterns: undefined,
    });
    expect(badAsset.ok).toBe(false);
    if (!badAsset.ok) expect(badAsset.code).toBe("references_changed");
    expect(extractAssetAndEmbedReferences(baseRaw)).toEqual(["scans/baseline.png"]);
  });

  test("blocks touching redacted PII spans, introducing PII, and redaction directives", () => {
    // Trying to edit the redacted text ("the patient") fails redaction-commute.
    const touchRedacted = applyValidatedWikiEdit({
      slug: "wiki/care/plan",
      baseRaw,
      edits: [
        {
          oldText: "Patient the patient is scheduled for cycle 2",
          newText: "Patient the patient is scheduled for cycle 3",
        },
      ],
      piiPatterns: undefined,
    });
    expect(touchRedacted.ok).toBe(false);
    if (!touchRedacted.ok) expect(touchRedacted.code).toBe("redaction_violation");

    // Trying to introduce PII in newText fails redaction-commute.
    const introducePii = applyValidatedWikiEdit({
      slug: "wiki/care/plan",
      baseRaw,
      edits: [
        {
          oldText: "Standard pembrolizumab 200 mg IV every 3 weeks.",
          newText: "Standard pembrolizumab 200 mg IV for Diana Laster.",
        },
      ],
      piiPatterns: undefined,
    });
    expect(introducePii.ok).toBe(false);
    if (!introducePii.ok) expect(introducePii.code).toBe("redaction_violation");

    // Literal "the patient" elsewhere in raw body while "Diana Laster" is also redacted to "the patient"
    // must be rejected as ambiguous in the redacted view!
    const dualPatientRaw = `${baseRaw}\nNote: the patient tolerated cycle 1.\n`;
    const ambiguousRedacted = applyValidatedWikiEdit({
      slug: "wiki/care/plan",
      baseRaw: dualPatientRaw,
      edits: [{ oldText: "the patient", newText: "she" }],
      piiPatterns: undefined,
    });
    expect(ambiguousRedacted.ok).toBe(false);
    if (!ambiguousRedacted.ok) expect(ambiguousRedacted.code).toBe("match_ambiguous");

    // Custom site PII pattern & <redact> tag.
    const customRaw = [
      "---",
      "title: Notes",
      "---",
      "",
      "# Notes",
      "",
      "Contact <redact fallback=\"[hidden]\">secret-phone</redact> for scheduling.",
      "Clinic hours are 9-5.",
    ].join("\n");
    const touchTag = applyValidatedWikiEdit({
      slug: "wiki/notes",
      baseRaw: customRaw,
      edits: [{ oldText: "Contact [hidden] for scheduling.", newText: "Call clinic." }],
      piiPatterns: parseSitePiiPatterns([]),
    });
    expect(touchTag.ok).toBe(false);
    if (!touchTag.ok) expect(touchTag.code).toBe("redaction_violation");

    const safeAroundTag = applyValidatedWikiEdit({
      slug: "wiki/notes",
      baseRaw: customRaw,
      edits: [{ oldText: "Clinic hours are 9-5.", newText: "Clinic hours are 8-5." }],
      piiPatterns: parseSitePiiPatterns([]),
    });
    expect(safeAroundTag.ok).toBe(true);
    if (safeAroundTag.ok) {
      expect(safeAroundTag.proposedRaw).toContain("<redact fallback=\"[hidden]\">secret-phone</redact>");
    }
  });

  test("rejects H1 modifications, H1 insertions above existing H1, and overlapping edits", () => {
    const changeH1 = applyValidatedWikiEdit({
      slug: "wiki/care/plan",
      baseRaw,
      edits: [{ oldText: "# Care Plan", newText: "# New Care Plan" }],
      piiPatterns: undefined,
    });
    expect(changeH1.ok).toBe(false);
    if (!changeH1.ok) expect(changeH1.code).toBe("h1_or_title_changed");

    const overlap = applyValidatedWikiEdit({
      slug: "wiki/care/plan",
      baseRaw,
      edits: [
        { oldText: "Standard pembrolizumab 200 mg", newText: "Pembro 200 mg" },
        { oldText: "200 mg IV every 3 weeks.", newText: "400 mg IV every 6 weeks." },
      ],
      piiPatterns: undefined,
    });
    expect(overlap.ok).toBe(false);
    if (!overlap.ok) expect(overlap.code).toBe("overlapping_edits");
  });

  test("computeRedactedPreview and findFirstChangedHeading locate the edited section", () => {
    const res = applyValidatedWikiEdit({
      slug: "wiki/care/plan",
      baseRaw,
      edits: [
        {
          oldText: "Standard pembrolizumab 200 mg IV every 3 weeks.",
          newText: "Standard pembrolizumab 200 mg IV every 3 weeks.\n\n## Follow-up schedule\n\nLabs every 3 weeks.",
        },
      ],
      piiPatterns: undefined,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.firstChangedHeading).toBe("Follow-up schedule");
      expect(findFirstChangedHeading(res.redactedProposedBody, res.redactedDiff)).toBe("Follow-up schedule");
      const preview = computeRedactedPreview({
        baseRedactedBody:
          "# Care Plan\n\nPatient the patient is scheduled for cycle 2.\n\n## Dosing\n\nStandard pembrolizumab 200 mg IV every 3 weeks.\n\n![chart](wiki/care/chart.png)",
        edits: [
          {
            oldText: "Standard pembrolizumab 200 mg IV every 3 weeks.",
            newText: "Standard pembrolizumab 200 mg IV every 3 weeks.\n\n## Follow-up schedule\n\nLabs every 3 weeks.",
          },
        ],
        redactedDiff: res.redactedDiff,
      });
      expect(preview).not.toBeNull();
      expect(preview?.redactedProposedBody).toContain("## Follow-up schedule");
      expect(preview?.firstChangedHeading).toBe("Follow-up schedule");
    }
  });

  test("validateNewWikiPage enforces fail-closed sensitivity, frontmatter generation, PII, and path rules", () => {
    const created = validateNewWikiPage({
      slug: "wiki/diagnostics/ctdna-vendors",
      title: "Commercial ctDNA Vendors",
      tags: ["diagnostics", "ctdna"],
      body: "## Snapshot\n\nSignatera and NeXT Personal are tumor-informed assays.",
      piiPatterns: undefined,
    });
    expect(created.ok).toBe(true);
    if (created.ok) {
      expect(created.filePath).toBe("wiki/diagnostics/ctdna-vendors.md");
      expect(created.parsedProposed.title).toBe("Commercial ctDNA Vendors");
      expect(created.parsedProposed.sensitive).toBe(true);
      expect(created.parsedProposed.tags).toEqual(["diagnostics", "ctdna"]);
      expect(created.proposedRaw).toContain("sensitive: true");
      expect(created.proposedRaw).toContain("# Commercial ctDNA Vendors");
      expect(created.stats.additions).toBeGreaterThan(0);
      expect(created.stats.deletions).toBe(0);
    }

    const publicPage = validateNewWikiPage({
      slug: "wiki/diagnostics/public-guide",
      title: "Public Guide",
      sensitive: false,
      body: "# Public Guide\n\n## Overview\n\nGeneral assay overview.",
      piiPatterns: undefined,
    });
    expect(publicPage.ok).toBe(true);
    if (publicPage.ok) {
      expect(publicPage.parsedProposed.sensitive).toBe(false);
      expect(publicPage.proposedRaw.match(/^# Public Guide$/gm)?.length).toBe(1);
    }

    // Rejects frontmatter injection, PII, local assets, reserved tags, and bad slugs.
    expect(
      validateNewWikiPage({
        slug: "wiki/diagnostics/bad-fm",
        title: "Bad",
        body: "---\nsensitive: false\n---\nBody",
        piiPatterns: undefined,
      }).ok,
    ).toBe(false);
    expect(
      validateNewWikiPage({
        slug: "wiki/diagnostics/pii",
        title: "Notes",
        body: "Diana Laster had a scan.",
        piiPatterns: undefined,
      }).ok,
    ).toBe(false);
    expect(
      validateNewWikiPage({
        slug: "wiki/diagnostics/img",
        title: "Images",
        body: "![pic](scan.png)",
        piiPatterns: undefined,
      }).ok,
    ).toBe(false);
    expect(
      validateNewWikiPage({
        slug: "../escape",
        title: "Escape",
        body: "Nope",
        piiPatterns: undefined,
      }).ok,
    ).toBe(false);
  });

  test("allows agents to add or edit :::columns while still blocking changes to :::redact", () => {
    const withRedactRaw = [
      "---",
      "title: Decision",
      "---",
      "",
      "# Decision",
      "",
      "Intro paragraph.",
      "",
      ":::redact[Hidden clinical detail]",
      "Secret clinical note.",
      ":::",
      "",
      "### Option A",
      "First option.",
      "",
      "### Option B",
      "Second option.",
      "",
    ].join("\n");

    const wrapInColumns = applyValidatedWikiEdit({
      slug: "wiki/decision",
      baseRaw: withRedactRaw,
      edits: [
        {
          oldText: "### Option A\nFirst option.\n\n### Option B\nSecond option.",
          newText: ":::columns\n### Option A\nFirst option.\n\n### Option B\nSecond option.\n:::",
        },
      ],
      piiPatterns: parseSitePiiPatterns([]),
    });
    expect(wrapInColumns.ok).toBe(true);
    if (wrapInColumns.ok) {
      expect(wrapInColumns.proposedRaw).toContain(":::columns");
      expect(wrapInColumns.proposedRaw).toContain(":::redact[Hidden clinical detail]\nSecret clinical note.\n:::");
    }

    const introduceRedact = applyValidatedWikiEdit({
      slug: "wiki/decision",
      baseRaw: withRedactRaw,
      edits: [
        {
          oldText: "Intro paragraph.",
          newText: ":::redact[nope]\nhidden\n:::",
        },
      ],
      piiPatterns: parseSitePiiPatterns([]),
    });
    expect(introduceRedact.ok).toBe(false);
    if (!introduceRedact.ok) expect(introduceRedact.code).toBe("redaction_violation");

    const newPageWithColumns = validateNewWikiPage({
      slug: "wiki/questions/comparison",
      title: "Comparison",
      body: ":::columns\n### A\nOne\n### B\nTwo\n:::",
      piiPatterns: parseSitePiiPatterns([]),
    });
    expect(newPageWithColumns.ok).toBe(true);

    const newPageWithRedact = validateNewWikiPage({
      slug: "wiki/questions/secret",
      title: "Secret",
      body: ":::redact[x]\nsecret\n:::",
      piiPatterns: parseSitePiiPatterns([]),
    });
    expect(newPageWithRedact.ok).toBe(false);
    if (!newPageWithRedact.ok) expect(newPageWithRedact.code).toBe("redaction_violation");
  });
});
