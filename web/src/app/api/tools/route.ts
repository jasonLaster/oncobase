import { siteDataFromRequest } from "@/lib/site-data";

export async function POST(request: Request) {
  const { tool, args } = (await request.json()) as {
    tool: string;
    args: Record<string, unknown>;
  };

  const siteData = siteDataFromRequest(request);

  switch (tool) {
    case "search_wiki": {
      const results = await siteData.documents.search({
        query: args.query as string,
        limit: 8,
      });
      return Response.json(results);
    }
    case "read_page": {
      const doc = await siteData.documents.getBySlug({
        slug: args.slug as string,
      });
      if (!doc) return Response.json({ error: `Page not found: ${args.slug}` });
      return Response.json({
        slug: doc.slug,
        title: doc.title,
        tags: doc.tags,
        content: doc.content.slice(0, 8000),
      });
    }
    case "list_pages": {
      return Response.json(await siteData.documents.list());
    }
    case "get_pages_by_tag": {
      return Response.json(
        await siteData.documents.getByTag({
          tag: args.tag as string,
        }),
      );
    }
    case "list_tags": {
      return Response.json(await siteData.documents.listTags());
    }
    default:
      return Response.json({ error: `Unknown tool: ${tool}` }, { status: 400 });
  }
}
