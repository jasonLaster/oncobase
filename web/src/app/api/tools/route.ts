import { ConvexHttpClient } from "convex/browser";
import { api } from "@convex/_generated/api";

function getConvex() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  return new ConvexHttpClient(url);
}

export async function POST(request: Request) {
  const { tool, args } = (await request.json()) as {
    tool: string;
    args: Record<string, unknown>;
  };

  const convex = getConvex();

  switch (tool) {
    case "search_wiki": {
      const results = await convex.query(api.documents.search, {
        query: args.query as string,
        limit: 8,
      });
      return Response.json(results);
    }
    case "read_page": {
      const doc = await convex.query(api.documents.getBySlug, {
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
      return Response.json(await convex.query(api.documents.list, {}));
    }
    case "get_pages_by_tag": {
      return Response.json(
        await convex.query(api.documents.getByTag, { tag: args.tag as string })
      );
    }
    case "list_tags": {
      return Response.json(await convex.query(api.documents.listTags, {}));
    }
    default:
      return Response.json({ error: `Unknown tool: ${tool}` }, { status: 400 });
  }
}
