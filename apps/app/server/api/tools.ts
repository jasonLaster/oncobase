// The chat agent's tools over HTTP, for outside agents (about/agent-access).
// GET lists them with JSON Schema inputs; POST {tool, args} runs one. Both
// build from createViewerChatTools, so this endpoint offers exactly what the
// chat model gets, with the same access checks and redaction.
import type { ConvexHttpClient } from "convex/browser";
import { z } from "zod";
import { createViewerChatTools } from "../chat-route";
import { canUserAccessSlug, getSessionUser } from "../reader-access";

const PRIVATE = { "Cache-Control": "private, no-store", "X-Wiki-Cache-Scope": "session" } as const;

type ViewerTools = Awaited<ReturnType<typeof createViewerChatTools>>;
type AnyTool = {
  description: string;
  inputSchema: z.ZodType;
  execute: (args: never) => unknown;
};

export function describeTools(tools: ViewerTools) {
  return Object.entries(tools as Record<string, AnyTool>).map(([name, tool]) => {
    const { $schema: _ignored, ...inputSchema } = z.toJSONSchema(tool.inputSchema) as Record<string, unknown>;
    return { name, description: tool.description, inputSchema };
  });
}

export async function handleToolsRequest(
  request: Request,
  client: ConvexHttpClient,
  siteSlug: string,
) {
  if (request.method !== "GET" && request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405, headers: { Allow: "GET, POST" } });
  }

  const sessionUser = await getSessionUser(request, client, siteSlug);
  const tools = await createViewerChatTools({
    client,
    siteSlug,
    includeSensitive: Boolean(sessionUser),
    canAccessSlug: (slug) => canUserAccessSlug(client, siteSlug, sessionUser, slug),
    sessionUser,
  });

  if (request.method === "GET") {
    return Response.json({ tools: describeTools(tools) }, { headers: PRIVATE });
  }

  const body = (await request.json().catch(() => ({}))) as { tool?: unknown; args?: unknown };
  const name = typeof body.tool === "string" ? body.tool : "";
  const tool = Object.prototype.hasOwnProperty.call(tools, name) ? (tools as Record<string, AnyTool>)[name] : undefined;
  if (!tool) {
    return Response.json(
      { error: `Unknown tool: ${name || String(body.tool)}`, tools: Object.keys(tools) },
      { status: 400, headers: PRIVATE },
    );
  }
  const parsed = tool.inputSchema.safeParse(body.args ?? {});
  if (!parsed.success) {
    return Response.json(
      { error: `Invalid args for ${name}: ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "args"}: ${issue.message}`).join("; ")}` },
      { status: 400, headers: PRIVATE },
    );
  }
  return Response.json(await tool.execute(parsed.data as never), { headers: PRIVATE });
}
