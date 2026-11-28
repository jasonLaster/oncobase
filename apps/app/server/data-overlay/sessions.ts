// The overlay's view of diana-tnbc.com accounts: the same Convex session
// table (so access tokens from POST /api/auth/tokens work, and a role change
// that revokes a user's sessions also ends their data-host session) and the
// same role assignments as the wiki.

import type { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api.js";
import type { Id } from "../../convex/_generated/dataModel.js";
import { sessionUserRoleNames } from "../admin-auth";
import { createSessionToken, hashSessionToken } from "../user-auth";
import type { DataOverlaySessions } from "./handler";

export function createConvexDataSessions(client: ConvexHttpClient, siteSlug: string): DataOverlaySessions {
  return {
    async userForToken(token) {
      const user = await client.query(api.users.getSessionUser, { siteSlug, tokenHash: hashSessionToken(token) });
      return user ? { _id: user._id, email: user.email, name: user.name ?? null } : null;
    },
    rolesFor(user) {
      return sessionUserRoleNames(client, siteSlug, { _id: user._id as Id<"users">, email: user.email, name: user.name });
    },
    async createSession(userId, expiresAt) {
      const token = createSessionToken();
      await client.mutation(
        api.users.createSession,
        { siteSlug, userId: userId as Id<"users">, tokenHash: hashSessionToken(token), expiresAt },
        { skipQueue: true },
      );
      return token;
    },
    async revoke(token) {
      await client.mutation(api.users.deleteSession, { siteSlug, tokenHash: hashSessionToken(token) }, { skipQueue: true });
    },
  };
}
