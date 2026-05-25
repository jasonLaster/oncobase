export const SENSITIVE_PAGE_TAG = "sensitive";

const SENSITIVE_FRONTMATTER_KEYS = new Set(["sensitive"]);
const TRUTHY_FRONTMATTER_VALUES = new Set(["1", "true", "yes", "on"]);

type Frontmatter = Record<string, unknown>;

export function normalizeFrontmatterTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((tag): tag is string => typeof tag === "string")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function isTruthyFrontmatterValue(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value !== "string") return false;

  return TRUTHY_FRONTMATTER_VALUES.has(value.trim().toLowerCase());
}

export function hasSensitiveTag(tags: readonly string[] | undefined): boolean {
  return tags?.some((tag) => tag.trim().toLowerCase() === SENSITIVE_PAGE_TAG) ?? false;
}

export function isSensitiveFrontmatter(frontmatter: Frontmatter): boolean {
  for (const [key, value] of Object.entries(frontmatter)) {
    if (
      SENSITIVE_FRONTMATTER_KEYS.has(key.toLowerCase()) &&
      isTruthyFrontmatterValue(value)
    ) {
      return true;
    }
  }

  return hasSensitiveTag(normalizeFrontmatterTags(frontmatter.tags));
}
