import { ConvexError } from "convex/values";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { SERVICE_ISSUER, SERVICE_SUBJECT } from "./serviceAuth";
import { requireSite } from "./site";
import type { QueryCtx, MutationCtx } from "../_generated/server";

export function conversationGateVersion(site: { _id: string; config: { passwordGate: boolean; passwordHash?: string } }) {
  return bytesToHex(sha256(new TextEncoder().encode(JSON.stringify([site._id, site.config.passwordGate, site.config.passwordHash ?? null]))));
}
export async function requireConversationIdentity(ctx: QueryCtx | MutationCtx, args: { siteSlug?: string }) {
  const identity = await ctx.auth.getUserIdentity();
  if (identity?.issuer !== SERVICE_ISSUER) throw new ConvexError("Unauthorized");
  if (identity.subject === SERVICE_SUBJECT && identity.role === "backend-service") return;
  const slug = args.siteSlug ?? "diana";
  if (identity.role !== "wiki-conversations" || identity.siteSlug !== slug || identity.subject !== "wiki-browser:" + slug) throw new ConvexError("Unauthorized");
  const { site } = await requireSite(ctx, slug);
  if (!site || identity.gateVersion !== conversationGateVersion(site)) throw new ConvexError("Unauthorized");
}
