import type { ConvexHttpClient } from "convex/browser";
import { ConvexError } from "convex/values";
import { api } from "../../convex/_generated/api.js";
import { resolveChatOwner } from "../chat-owner";
import { getSessionUser, sessionTokenFromCookie } from "../reader-access";
import { boundedJson } from "../reader-telemetry";
import { hashSessionToken } from "../user-auth";
import {
  WikiEditError,
  approveAndPublishWikiEdit,
  rejectWikiEdit,
} from "../wiki-edit-service";

const RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  Vary: "Cookie, Host",
};

const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: RESPONSE_HEADERS });

function hasJsonContentType(request: Request): boolean {
  const ct = request.headers.get("content-type") ?? "";
  return ct.toLowerCase().split(";")[0]?.trim() === "application/json";
}

export async function handleWikiEditsRequest(
  request: Request,
  client: ConvexHttpClient,
  siteSlug: string,
) {
  const url = new URL(request.url);
  const isGet = url.pathname === "/api/chat/wiki-edits";
  const isApprove = url.pathname === "/api/chat/wiki-edits/approve";
  const isReject = url.pathname === "/api/chat/wiki-edits/reject";

  if (!isGet && !isApprove && !isReject) {
    return json({ error: "Not found" }, 404);
  }

  if (isGet && request.method !== "GET") {
    return new Response(null, {
      status: 405,
      headers: { ...RESPONSE_HEADERS, Allow: "GET" },
    });
  }
  if ((isApprove || isReject) && request.method !== "POST") {
    return new Response(null, {
      status: 405,
      headers: { ...RESPONSE_HEADERS, Allow: "POST" },
    });
  }

  // Cookie-authenticated state changes must match the current origin and use JSON.
  if (request.method !== "GET") {
    if (request.headers.get("origin") !== url.origin) {
      return json({ error: "Forbidden" }, 403);
    }
    if (!hasJsonContentType(request)) {
      return json({ error: "Content-Type must be application/json" }, 415);
    }
  }

  const rawSessionToken = sessionTokenFromCookie(request.headers.get("cookie") ?? "");
  if (!rawSessionToken) {
    return json({ error: "Only the site owner or an admin can edit the wiki." }, 403);
  }
  const sessionTokenHash = hashSessionToken(rawSessionToken);
  const sessionUser = await getSessionUser(request, client, siteSlug);
  if (!sessionUser) {
    return json({ error: "Only the site owner or an admin can edit the wiki." }, 403);
  }
  const ownerKey = resolveChatOwner(request, siteSlug, sessionUser).ownerKey;

  try {
    if (isGet) {
      const proposalId = url.searchParams.get("id")?.trim() ?? "";
      if (!proposalId || proposalId.length > 128) {
        return json({ error: "Proposal id is required" }, 400);
      }
      const proposal = await client.query(api.wikiEdits.getProposal, {
        siteSlug,
        sessionTokenHash,
        ownerKey,
        proposalId,
      });
      if (!proposal) return json({ error: "Proposal not found" }, 404);
      return json({ proposal });
    }

    const body = (await boundedJson(request, 8192)) as Record<string, unknown>;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return json({ error: "Invalid request body" }, 400);
    }
    const proposalId = typeof body.proposalId === "string" ? body.proposalId.trim() : "";
    if (!proposalId || proposalId.length > 128) {
      return json({ error: "proposalId is required" }, 400);
    }

    if (isReject) {
      const proposal = await rejectWikiEdit({
        client,
        siteSlug,
        sessionTokenHash,
        ownerKey,
        proposalId,
      });
      return json({ proposal });
    }

    const outcome = await approveAndPublishWikiEdit({
      client,
      siteSlug,
      sessionTokenHash,
      ownerKey,
      proposalId,
    });
    const status = outcome.status === "committed_pending_publish" ? 202 : 200;
    return json(outcome, status);
  } catch (error) {
    if (error instanceof SyntaxError) return json({ error: "Invalid JSON body" }, 400);
    if (error instanceof Error && error.message === "Invalid telemetry size") {
      return json({ error: "Request too large or empty" }, 413);
    }
    if (error instanceof WikiEditError) {
      return json({ error: error.message, code: error.code }, error.status);
    }
    if (error instanceof ConvexError) {
      let msg = typeof error.data === "string" ? error.data : "Request failed";
      if (msg.startsWith('"') && msg.endsWith('"')) {
        try {
          const parsed = JSON.parse(msg);
          if (typeof parsed === "string") msg = parsed;
        } catch {
          // Keep original string if not JSON-quoted.
        }
      }
      if (msg === "Forbidden") {
        return json({ error: "Only the site owner or an admin can edit the wiki." }, 403);
      }
      if (msg === "Not found") return json({ error: "Proposal not found" }, 404);
      if (
        msg === "Already executing" ||
        msg === "Already published" ||
        msg === "Already rejected" ||
        msg === "Proposal expired" ||
        msg.startsWith("Cannot reject")
      ) {
        return json({ error: msg }, 409);
      }
      return json({ error: msg }, 400);
    }
    return json({ error: "Wiki edit failed unexpectedly. Please retry." }, 500);
  }
}
