import { siteDataFromRequest } from "@/lib/site-data";
import { readChatPage } from "@/lib/chat-page-reader";

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
      return Response.json(await readChatPage(siteData, args.slug as string));
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
