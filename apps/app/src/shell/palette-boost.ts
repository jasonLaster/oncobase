/** Ranking prior for the file palette, from the vault's folder conventions:
 * curated wiki/ pages and patient records first, research clippings and
 * archives last, and among dated records (MM-DD-…) the newer one. Kept small
 * against the 0–1 relevance score, so it settles near-ties rather than
 * overriding what the reader typed. */
const LOWER = /^(asco|catalogs|clippings|google drive|project-management|sources\/research|sources\/resources)(\/|$)/;

export function paletteBoost(slug: string) {
  const path = slug.toLowerCase();
  let boost = 0;
  if (path.startsWith("wiki/")) boost += path.startsWith("wiki/education/") ? 0.04 : 0.12;
  else if (/^sources\/(diagnostics|medical-records|test-results)\//.test(path)) boost += 0.08;
  else if (/^sources\/meeting-notes\/.*-overview$/.test(path)) boost += 0.04;
  else if (LOWER.test(path)) boost -= 0.12;
  if (/(^|\/)(archived?|archives)(\/|$)/.test(path) || path.includes("/attachments/")) boost -= 0.1;
  // The newest dated record among similar ones; a month-day prefix on any segment.
  const date = path.match(/(?:^|\/)(\d{2})-(\d{2})-[^/]*$/) ?? path.match(/(?:^|\/)(\d{2})-(\d{2})-[^/]*\/[^/]*$/);
  if (date) {
    const month = Number(date[1]), day = Number(date[2]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) boost += 0.06 * ((month - 1) * 31 + day) / 372;
  }
  return boost;
}
