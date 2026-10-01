/** The public curriculum has its own reader cache, separate from the care wiki. */
export const EDUCATION_ACCESS_PARTITION = "education";

export function isEducationSlug(slug: string): boolean {
  const parts = slug.split("/");
  return parts.length >= 2 && parts[0]?.toLowerCase() === "wiki" &&
    parts[1]?.toLowerCase() === "education" &&
    parts.every(part => Boolean(part) && part !== "." && part !== ".." &&
      !/[\\%?#\u0000-\u001f]/.test(part));
}

export function isEducationPathname(pathname: string): boolean {
  try {
    return isEducationSlug(decodeURIComponent(pathname.replace(/^\//, ""))
      .replace(/\.(?:md|mdx)$/i, "").replace(/\/$/, ""));
  } catch { return false; }
}

export function educationOnlyResponse(): boolean {
  return document.querySelector<HTMLMetaElement>('meta[name="wiki-reader-access"]')?.content === EDUCATION_ACCESS_PARTITION;
}
