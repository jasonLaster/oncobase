export type RoleRules = {
  includePathPatterns: string[];
  excludePathPatterns: string[];
  includeTags: string[];
  excludeTags: string[];
  emailPatterns: string[];
};

export type PreviewPage = {
  slug: string;
  title: string;
  tags: string[];
  sensitiveInclude?: string[];
  sensitive?: boolean;
  sourceSensitive?: boolean;
};

export type PreviewStatus = "all" | "included" | "excluded" | "unmatched";

export function listToText(values: string[]) {
  return values.join(", ");
}

export function textToList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function patternMatches(pattern: string, slug: string) {
  const normalized = pattern.trim();
  if (!normalized) return false;
  if (normalized === "*") return true;
  if (normalized.endsWith("*")) {
    return slug.startsWith(normalized.slice(0, -1));
  }
  return slug === normalized;
}

export function anyPatternMatches(patterns: string[], slug: string) {
  return patterns.some((pattern) => patternMatches(pattern, slug));
}

const LEGACY_SENSITIVE_INCLUDE_TAGS = new Map([
  ["echo-sensitive", "echo"],
  ["serova-sensitive", "serova"],
]);

function tagMatchesRuleTag(
  ruleTag: string,
  pageTags: Set<string>,
  sensitiveInclude: Set<string>,
) {
  const normalizedRuleTag = ruleTag.trim().toLowerCase();
  const legacyAlias = LEGACY_SENSITIVE_INCLUDE_TAGS.get(normalizedRuleTag);
  if (legacyAlias) {
    return pageTags.has(normalizedRuleTag) || sensitiveInclude.has(legacyAlias);
  }

  if (pageTags.has(normalizedRuleTag) || sensitiveInclude.has(normalizedRuleTag)) {
    return true;
  }

  for (const [legacyTag, canonicalTag] of LEGACY_SENSITIVE_INCLUDE_TAGS) {
    if (canonicalTag === normalizedRuleTag && pageTags.has(legacyTag)) {
      return true;
    }
  }

  return false;
}

export function classifyPage(
  page: PreviewPage,
  rules: RoleRules,
): { status: Exclude<PreviewStatus, "all">; reasons: string[] } {
  const hasIncludePaths = rules.includePathPatterns.length > 0;
  const hasIncludeTags = rules.includeTags.length > 0;
  const pathIncluded =
    !hasIncludePaths || anyPatternMatches(rules.includePathPatterns, page.slug);
  const normalizedPageTags = new Set(
    page.tags.map((tag) => tag.trim().toLowerCase()),
  );
  const normalizedSensitiveInclude = new Set(
    (page.sensitiveInclude ?? []).map((tag) => tag.trim().toLowerCase()),
  );
  const tagIncluded =
    !hasIncludeTags ||
    rules.includeTags.some((tag) =>
      tagMatchesRuleTag(tag, normalizedPageTags, normalizedSensitiveInclude),
    );
  const pathExcluded = anyPatternMatches(rules.excludePathPatterns, page.slug);
  const tagExcluded = rules.excludeTags.some((tag) =>
    tagMatchesRuleTag(tag, normalizedPageTags, normalizedSensitiveInclude),
  );

  if (pathIncluded && tagIncluded && !pathExcluded && !tagExcluded) {
    return {
      status: "included",
      reasons: [
        hasIncludePaths ? "include path" : "any path",
        hasIncludeTags ? "include tag" : "any tag",
      ],
    };
  }

  if (pathIncluded && tagIncluded && (pathExcluded || tagExcluded)) {
    return {
      status: "excluded",
      reasons: [
        ...(pathExcluded ? ["exclude path"] : []),
        ...(tagExcluded ? ["exclude tag"] : []),
      ],
    };
  }

  return {
    status: "unmatched",
    reasons: [
      ...(!pathIncluded ? ["path"] : []),
      ...(!tagIncluded ? ["tag"] : []),
    ],
  };
}
