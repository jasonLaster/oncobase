export type EducationPage = { slug: string; title: string; description?: string };
export function educationTopics<T extends EducationPage>(pages: T[]) {
  const grouped = new Map<string, T[]>();
  for (const page of pages) {
    const relative = page.slug.replace(/^wiki\/education\//, "");
    const key = relative.includes("/") ? relative.split("/")[0]! : "overview";
    const group = grouped.get(key) ?? [];
    group.push(page);
    grouped.set(key, group);
  }
  return [...grouped].map(([key, group]) => {
    const pages = [...group].sort((a, b) =>
      a.slug.endsWith("/index") !== b.slug.endsWith("/index")
        ? a.slug.endsWith("/index") ? -1 : 1 : a.title.localeCompare(b.title));
    const entry = pages.find(page => page.slug === `wiki/education/${key}/index`) ?? pages[0]!;
    return { key, title: key === "overview" ? "Getting started" : entry.title,
      description: entry.description ?? "Explore the lessons, visual explanations, and resources in this topic.", entry, pages };
  }).sort((a, b) => a.key === "overview" ? -1 : b.key === "overview" ? 1 : a.title.localeCompare(b.title));
}
