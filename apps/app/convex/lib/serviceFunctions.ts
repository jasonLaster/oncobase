// Preserve Convex's inferred argument/return contracts while enforcing service
// authentication before any handler can read or mutate data.
 
import { query as baseQuery, mutation as baseMutation, action as baseAction, internalQuery } from "../_generated/server";
import type { RegisteredQuery } from "convex/server";
import { requireConversationIdentity } from "./conversationAuth";
import { requireServiceIdentity } from "./serviceAuth";
import { requirePrefetchSecret } from "./prefetchPriority";

type Definition = { args?: any; returns?: any; handler: (ctx: any, args: any) => any };
const definitions = new WeakMap<object, Definition>();
function authenticated<Builder>(builder: Builder, authorize: (ctx: any, args: any) => Promise<unknown> = requireServiceIdentity): Builder {
  return ((definition: Definition) => {
    const registered = (builder as any)({ ...definition, handler: async (ctx: any, args: any) => {
      await authorize(ctx, args);
      return definition.handler(ctx, args);
    } });
    definitions.set(registered, definition);
    return registered;
  }) as Builder;
}
export const query = authenticated(baseQuery);
export const mutation = authenticated(baseMutation);
export const action = authenticated(baseAction);
export const conversationQuery = authenticated(baseQuery, requireConversationIdentity);
export const conversationMutation = authenticated(baseMutation, requireConversationIdentity);

// Transitional: manifest snapshot and prefetch functions used to authenticate
// with a shared `serverSecret` argument. Accept the service JWT (what the app
// server now sends) or, for one deploy, a correct legacy secret, so app and
// Convex can deploy in either order. Remove the secret path once no deployed
// app sends `serverSecret`.
async function requireServiceIdentityOrLegacySecret(ctx: any, args: { serverSecret?: string }) {
  if (args?.serverSecret !== undefined) return requirePrefetchSecret(args.serverSecret, process.env.WIKI_PREFETCH_SECRET);
  return requireServiceIdentity(ctx);
}
export const serviceOrSecretQuery = authenticated(baseQuery, requireServiceIdentityOrLegacySecret);
export const serviceOrSecretMutation = authenticated(baseMutation, requireServiceIdentityOrLegacySecret);
export type { QueryCtx, MutationCtx, ActionCtx } from "../_generated/server";

// Scheduled manifest work has no user identity. Give it explicit internal
// entrypoints, inaccessible to the public API, using the same validated handler.
export function internalQueryFor<Args extends Record<string, any>, Result>(registered: RegisteredQuery<"public", Args, Result>): RegisteredQuery<"internal", Args, Result> {
  const definition = definitions.get(registered);
  if (!definition) throw new Error("Unknown service query");
  return internalQuery(definition as any) as RegisteredQuery<"internal", Args, Result>;
}
