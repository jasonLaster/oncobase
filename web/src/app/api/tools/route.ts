import {
  getMarkdownFile,
  getAllSlugs,
  getAllTags,
  getPagesByTag,
} from "@/lib/markdown";
import { searchMarkdown } from "@/lib/search";

export async function POST(request: Request) {
  const { tool, args } = (await request.json()) as {
    tool: string;
    args: Record<string, unknown>;
  };

  switch (tool) {
    case "search_wiki": {
      const results = await searchMarkdown(args.query as string);
      return Response.json(
        results.slice(0, 8).map((r) => ({
          slug: r.slug,
          title: r.title,
          matchCount: r.matches.length,
          excerpts: r.matches.slice(0, 3).map((m) => m.lineContent.trim()),
        }))
      );
    }
    case "read_page": {
      const file = getMarkdownFile(args.slug as string);
      if (!file) return Response.json({ error: `Page not found: ${args.slug}` });
      return Response.json({
        slug: file.slug,
        title: file.title,
        tags: file.frontmatter.tags || [],
        content: file.content.slice(0, 8000),
      });
    }
    case "list_pages": {
      const slugs = getAllSlugs();
      return Response.json(
        slugs.map((s) => {
          const file = getMarkdownFile(s);
          return {
            slug: s,
            title: file?.title || s,
            tags: (file?.frontmatter.tags as string[]) || [],
          };
        })
      );
    }
    case "get_pages_by_tag": {
      return Response.json(getPagesByTag(args.tag as string));
    }
    case "list_tags": {
      return Response.json(getAllTags());
    }
    default:
      return Response.json({ error: `Unknown tool: ${tool}` }, { status: 400 });
  }
}
