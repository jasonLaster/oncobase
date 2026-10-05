import { ConvexError } from "convex/values";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { SERVICE_ISSUER, SERVICE_SUBJECT } from "./serviceAuth";
import { requireSite } from "./site";
import type { QueryCtx, MutationCtx } from "../_generated/server";

export function conversationGateVersion(site: { _id: string; config: { passwordGate: boolean; passwordHash?: string } }) {
  return bytesToHex(sha256(new TextEncoder().encode(JSON.stringify([site._id, site.config.passwordGate, site.config.passwordHash ?? null]))));
}

/**
 * Stable, non-reversible conversation owner key. `principal` is a server-side
 * identity (`user:<id>` or `anon:<random httpOnly cookie>`); only this hash
 * leaves the app server, so neither a token nor a stored row reveals the cookie.
 */
export function conversationOwnerKey(siteSlug: string, principal: string) {
  return bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(["wiki-chat-owner:v1", siteSlug, principal]))));
}

const OWNER_KEY_RE = /^[0-9a-f]{64}$/;

/**
 * Which conversations the caller may touch.
 * - `owner`: only rows whose `ownerKey` equals this value. Every caller needs
 *   one: a backend-service call without an explicit `ownerKey` is rejected, so
 *   a server path that forgets it fails closed instead of seeing every
 *   viewer's conversations (including the care team's sensitive chats).
 * - `none`: a browser token without an owner claim (issued by an old app
 *   server). It matches no conversation and cannot create one.
 */
export type ConversationOwner =
  | { scope: "owner"; ownerKey: string }
  | { scope: "none" };

type ConversationArgs = { siteSlug?: string; ownerKey?: string };
const resolvedOwners = new WeakMap<object, ConversationOwner>();

export async function requireConversationIdentity(ctx: QueryCtx | MutationCtx, args: ConversationArgs): Promise<ConversationOwner> {
  const identity = await ctx.auth.getUserIdentity();
  if (identity?.issuer !== SERVICE_ISSUER) throw new ConvexError("Unauthorized");
  let owner: ConversationOwner;
  if (identity.subject === SERVICE_SUBJECT && identity.role === "backend-service") {
    if (args.ownerKey !== undefined && OWNER_KEY_RE.test(args.ownerKey)) owner = { scope: "owner", ownerKey: args.ownerKey };
    else throw new ConvexError("Unauthorized");
  } else {
    const slug = args.siteSlug ?? "diana";
    if (identity.role !== "wiki-conversations" || identity.siteSlug !== slug || identity.subject !== "wiki-browser:" + slug) throw new ConvexError("Unauthorized");
    const { site } = await requireSite(ctx, slug);
    if (!site || identity.gateVersion !== conversationGateVersion(site)) throw new ConvexError("Unauthorized");
    // Browsers never choose their owner (any `ownerKey` argument is ignored):
    // the claim is signed by the app server that set the owner cookie.
    const claimed = identity.ownerKey;
    owner = typeof claimed === "string" && OWNER_KEY_RE.test(claimed) ? { scope: "owner", ownerKey: claimed } : { scope: "none" };
  }
  resolvedOwners.set(ctx, owner);
  return owner;
}

/** The owner scope resolved by the auth wrapper for this function call. */
export async function conversationOwner(ctx: QueryCtx | MutationCtx, args: ConversationArgs): Promise<ConversationOwner> {
  return resolvedOwners.get(ctx) ?? requireConversationIdentity(ctx, args);
}

export function ownerAllows(owner: ConversationOwner, row: { ownerKey?: string }) {
  if (owner.scope === "none") return false;
  return row.ownerKey === owner.ownerKey;
}
