import { ConvexError } from "convex/values";
import type { Auth } from "convex/server";

export const SERVICE_ISSUER = "https://oncobase.app/backend";
export const SERVICE_AUDIENCE = "oncobase-backend";
export const SERVICE_SUBJECT = "wiki-application-server";

export async function requireServiceIdentity(ctx: { auth: Auth }) {
  const identity = await ctx.auth.getUserIdentity();
  if (identity?.issuer !== SERVICE_ISSUER || identity.subject !== SERVICE_SUBJECT || identity.role !== "backend-service") {
    throw new ConvexError("Unauthorized");
  }
}
