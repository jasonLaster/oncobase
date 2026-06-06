import type { ConvexHttpClient } from "convex/browser";
/* eslint-disable @typescript-eslint/no-explicit-any */
import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
  FunctionType,
} from "convex/server";
import { api } from "@convex/_generated/api";
import { getConvexServerClient } from "@/lib/convex-server";
import {
  siteSlugFromRequest,
  toSiteSlug,
  type SiteSlug,
} from "@/lib/site";

export type SiteScope = {
  readonly siteSlug: SiteSlug;
};

type SiteConvexClient = Pick<ConvexHttpClient, "query" | "mutation" | "action">;
type AnyFunctionReference = FunctionReference<FunctionType>;
type SiteScopedArgs<FuncRef extends AnyFunctionReference> =
  FunctionArgs<FuncRef> extends { siteSlug?: string }
    ? Omit<FunctionArgs<FuncRef>, "siteSlug"> & { siteSlug?: never }
    : never;

function addSiteSlug<FuncRef extends AnyFunctionReference>(
  scope: SiteScope,
  args: SiteScopedArgs<FuncRef>,
): FunctionArgs<FuncRef> {
  return { ...args, siteSlug: scope.siteSlug } as FunctionArgs<FuncRef>;
}

function shouldRetryWithoutIncludeSensitive(
  args: unknown,
  error: unknown,
): args is { includeSensitive: boolean } {
  if (process.env.VERCEL_ENV !== "preview") return false;
  if (!args || typeof args !== "object" || !("includeSensitive" in args)) {
    return false;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /includeSensitive|extra field|Object contains extra field|Server Error/i.test(
    message,
  );
}

async function withPreviewIncludeSensitiveFallback<TArgs, TResult>(
  args: TArgs,
  call: (args: TArgs) => Promise<TResult>,
): Promise<TResult> {
  try {
    return await call(args);
  } catch (error) {
    if (!shouldRetryWithoutIncludeSensitive(args, error)) throw error;
    const legacyArgs = { ...(args as Record<string, unknown>) };
    delete legacyArgs.includeSensitive;
    return await call(legacyArgs as TArgs);
  }
}

export function siteScopeFromRequest(request: { headers: Headers }): SiteScope {
  return { siteSlug: siteSlugFromRequest(request) };
}

export function siteScopeFromSlug(siteSlug: string): SiteScope {
  return { siteSlug: toSiteSlug(siteSlug) };
}

export function createSiteConvex(
  scope: SiteScope,
  client: SiteConvexClient = getConvexServerClient(),
) {
  return {
    query<FuncRef extends FunctionReference<"query">>(
      ref: FuncRef,
      args: SiteScopedArgs<FuncRef>,
    ): Promise<Awaited<FunctionReturnType<FuncRef>>> {
      return client.query(ref, addSiteSlug(scope, args));
    },
    mutation<FuncRef extends FunctionReference<"mutation">>(
      ref: FuncRef,
      args: SiteScopedArgs<FuncRef>,
    ): Promise<Awaited<FunctionReturnType<FuncRef>>> {
      return client.mutation(ref, addSiteSlug(scope, args));
    },
    action<FuncRef extends FunctionReference<"action">>(
      ref: FuncRef,
      args: SiteScopedArgs<FuncRef>,
    ): Promise<Awaited<FunctionReturnType<FuncRef>>> {
      return client.action(ref, addSiteSlug(scope, args));
    },
  };
}

export function createSiteData(
  scope: SiteScope,
  client: SiteConvexClient = getConvexServerClient(),
) {
  const convex = createSiteConvex(scope, client);

  return {
    siteSlug: scope.siteSlug,
    convex,
    documents: {
      search: (args: SiteScopedArgs<typeof api.documents.search>) =>
        withPreviewIncludeSensitiveFallback(args, (nextArgs) =>
          convex.query(api.documents.search, nextArgs),
        ),
      getBySlug: (args: SiteScopedArgs<typeof api.documents.getBySlug>) =>
        withPreviewIncludeSensitiveFallback(args, (nextArgs) =>
          convex.query(api.documents.getBySlug, nextArgs),
        ),
      getById: (args: SiteScopedArgs<typeof api.documents.getById>) =>
        withPreviewIncludeSensitiveFallback(args, (nextArgs) =>
          convex.query(api.documents.getById, nextArgs),
        ),
      list: (args: SiteScopedArgs<typeof api.documents.list> = {}) =>
        withPreviewIncludeSensitiveFallback(args, (nextArgs) =>
          convex.action(api.documents.list, nextArgs),
        ),
      getByTag: (args: SiteScopedArgs<typeof api.documents.getByTag>) =>
        convex.action(api.documents.getByTag, args),
      getManifestBySlug: (args: {
        slug: string;
        includeSensitive?: boolean;
      }) =>
        withPreviewIncludeSensitiveFallback(args, (nextArgs) =>
          convex.query((api as any).documents.getManifestBySlug, {
            ...nextArgs,
            siteSlug: scope.siteSlug,
          } as any),
        ),
      listTags: () => convex.action(api.documents.listTags, {}),
      vectorSearch: (args: SiteScopedArgs<typeof api.documents.vectorSearch>) =>
        convex.action(api.documents.vectorSearch, args),
      embeddingStatusPage: (
        args: SiteScopedArgs<typeof api.documents.embeddingStatusPage>,
      ) =>
        withPreviewIncludeSensitiveFallback(args, (nextArgs) =>
          convex.query(api.documents.embeddingStatusPage, nextArgs),
        ),
      listPageWithContent: (
        args: SiteScopedArgs<typeof api.documents.listPageWithContent>,
      ) =>
        withPreviewIncludeSensitiveFallback(args, (nextArgs) =>
          convex.query(api.documents.listPageWithContent, nextArgs),
        ),
      listPage: (args: SiteScopedArgs<typeof api.documents.listPage>) =>
        withPreviewIncludeSensitiveFallback(args, (nextArgs) =>
          convex.query(api.documents.listPage, nextArgs),
        ),
      listManifestPage: (
        args: SiteScopedArgs<typeof api.documents.listManifestPage>,
      ) =>
        withPreviewIncludeSensitiveFallback(args, (nextArgs) =>
          convex.query(api.documents.listManifestPage, nextArgs),
        ),
      listPageWithDescriptions: (
        args: SiteScopedArgs<typeof api.documents.listPageWithDescriptions>,
      ) =>
        withPreviewIncludeSensitiveFallback(args, (nextArgs) =>
          convex.query(api.documents.listPageWithDescriptions, nextArgs),
        ),
      listPageDescriptions: (
        args: SiteScopedArgs<typeof api.documents.listPageDescriptions>,
      ) =>
        withPreviewIncludeSensitiveFallback(args, (nextArgs) =>
          convex.query(api.documents.listPageDescriptions, nextArgs),
        ),
      listPdfAssets: (
        args: SiteScopedArgs<typeof api.documents.listPdfAssets> = {},
      ) =>
        withPreviewIncludeSensitiveFallback(args, (nextArgs) =>
          convex.query(api.documents.listPdfAssets, nextArgs),
        ),
      listFileAssets: (
        args: SiteScopedArgs<typeof api.documents.listFileAssets> = {},
      ) =>
        withPreviewIncludeSensitiveFallback(args, (nextArgs) =>
          convex.query(api.documents.listFileAssets, nextArgs),
        ),
      listPdfAssetPathsPage: (
        args: SiteScopedArgs<typeof api.documents.listPdfAssetPathsPage>,
      ) =>
        withPreviewIncludeSensitiveFallback(args, (nextArgs) =>
          convex.query(api.documents.listPdfAssetPathsPage, nextArgs),
        ),
      listFileAssetPathsPage: (
        args: SiteScopedArgs<typeof api.documents.listFileAssetPathsPage>,
      ) =>
        withPreviewIncludeSensitiveFallback(args, (nextArgs) =>
          convex.query(api.documents.listFileAssetPathsPage, nextArgs),
        ),
      assetHashesPage: (
        args: SiteScopedArgs<typeof api.documents.assetHashesPage>,
      ) =>
        withPreviewIncludeSensitiveFallback(args, (nextArgs) =>
          convex.query(api.documents.assetHashesPage, nextArgs),
        ),
      getPdfAssetByPath: (
        args: SiteScopedArgs<typeof api.documents.getPdfAssetByPath>,
      ) =>
        withPreviewIncludeSensitiveFallback(args, (nextArgs) =>
          convex.query(api.documents.getPdfAssetByPath, nextArgs),
        ),
      getFileAssetByPath: (
        args: SiteScopedArgs<typeof api.documents.getFileAssetByPath>,
      ) =>
        withPreviewIncludeSensitiveFallback(args, (nextArgs) =>
          convex.query(api.documents.getFileAssetByPath, nextArgs),
        ),
      getMeta: (args: SiteScopedArgs<typeof api.documents.getMeta>) =>
        convex.query(api.documents.getMeta, args),
      setMeta: (args: SiteScopedArgs<typeof api.documents.setMeta>) =>
        convex.mutation(api.documents.setMeta, args),
      setDescription: (
        args: SiteScopedArgs<typeof api.documents.setDescription>,
      ) => convex.mutation(api.documents.setDescription, args),
      upsert: (args: SiteScopedArgs<typeof api.documents.upsert>) =>
        convex.mutation(api.documents.upsert, args),
      upsertEmbedding: (
        args: SiteScopedArgs<typeof api.documents.upsertEmbedding>,
      ) => convex.mutation(api.documents.upsertEmbedding, args),
      upsertPdfAsset: (
        args: SiteScopedArgs<typeof api.documents.upsertPdfAsset>,
      ) => convex.mutation(api.documents.upsertPdfAsset, args),
      upsertFileAsset: (
        args: SiteScopedArgs<typeof api.documents.upsertFileAsset>,
      ) => convex.mutation(api.documents.upsertFileAsset, args),
      backfillAssetHashes: (
        args: SiteScopedArgs<typeof api.documents.backfillAssetHashes>,
      ) => convex.mutation(api.documents.backfillAssetHashes, args),
      bulkSetContentHash: (
        args: SiteScopedArgs<typeof api.documents.bulkSetContentHash>,
      ) => convex.mutation(api.documents.bulkSetContentHash, args),
      deleteBySlug: (args: SiteScopedArgs<typeof api.documents.deleteBySlug>) =>
        convex.mutation(api.documents.deleteBySlug, args),
      deletePdfAssetByPath: (
        args: SiteScopedArgs<typeof api.documents.deletePdfAssetByPath>,
      ) => convex.mutation(api.documents.deletePdfAssetByPath, args),
      deleteFileAssetByPath: (
        args: SiteScopedArgs<typeof api.documents.deleteFileAssetByPath>,
      ) => convex.mutation(api.documents.deleteFileAssetByPath, args),
    },
    users: {
      getByEmailForAuth: (
        args: SiteScopedArgs<typeof api.users.getByEmailForAuth>,
      ) => convex.query(api.users.getByEmailForAuth, args),
      getUsersByIds: (args: SiteScopedArgs<typeof api.users.getUsersByIds>) =>
        convex.query(api.users.getUsersByIds, args),
      getSessionUser: (args: SiteScopedArgs<typeof api.users.getSessionUser>) =>
        convex.query(api.users.getSessionUser, args),
      create: (args: SiteScopedArgs<typeof api.users.create>) =>
        convex.mutation(api.users.create, args),
      createSession: (args: SiteScopedArgs<typeof api.users.createSession>) =>
        convex.mutation(api.users.createSession, args),
      deleteSession: (args: SiteScopedArgs<typeof api.users.deleteSession>) =>
        convex.mutation(api.users.deleteSession, args),
    },
    guestNames: {
      upsert: (args: SiteScopedArgs<typeof api.guestNames.upsert>) =>
        convex.mutation(api.guestNames.upsert, args),
      getByIds: (args: SiteScopedArgs<typeof api.guestNames.getByIds>) =>
        convex.query(api.guestNames.getByIds, args),
    },
    commentRooms: {
      listActive: () => convex.query(api.commentRooms.listActive, {}),
      syncRooms: (args: SiteScopedArgs<typeof api.commentRooms.syncRooms>) =>
        convex.mutation(api.commentRooms.syncRooms, args),
      incrementRoom: (
        args: SiteScopedArgs<typeof api.commentRooms.incrementRoom>,
      ) => convex.mutation(api.commentRooms.incrementRoom, args),
      decrementRoom: (
        args: SiteScopedArgs<typeof api.commentRooms.decrementRoom>,
      ) => convex.mutation(api.commentRooms.decrementRoom, args),
    },
    conversations: {
      refs: api.conversations,
      beginRun: (args: SiteScopedArgs<typeof api.conversations.beginRun>) =>
        convex.mutation(api.conversations.beginRun, args),
      getCancelState: (
        args: SiteScopedArgs<typeof api.conversations.getCancelState>,
      ) => convex.query(api.conversations.getCancelState, args),
    },
    access: {
      listUsersWithRoles: () =>
        convex.query((api as any).access.listUsersWithRoles, {
          siteSlug: scope.siteSlug,
        } as any),
      listRoles: () =>
        convex.query((api as any).access.listRoles, {
          siteSlug: scope.siteSlug,
        } as any),
      createRole: (args: {
        name: string;
        description?: string;
        pathPatterns?: string[];
        includePathPatterns?: string[];
        excludePathPatterns?: string[];
        includeTags?: string[];
        excludeTags?: string[];
        emailPatterns?: string[];
      }) =>
        convex.mutation((api as any).access.createRole, {
          ...args,
          siteSlug: scope.siteSlug,
        } as any),
      updateRole: (args: {
        roleId: string;
        name: string;
        description?: string;
        pathPatterns?: string[];
        includePathPatterns?: string[];
        excludePathPatterns?: string[];
        includeTags?: string[];
        excludeTags?: string[];
        emailPatterns?: string[];
      }) =>
        convex.mutation((api as any).access.updateRole, {
          ...args,
          siteSlug: scope.siteSlug,
        } as any),
      deleteRole: (args: { roleId: string }) =>
        convex.mutation((api as any).access.deleteRole, {
          ...args,
          siteSlug: scope.siteSlug,
        } as any),
      assignRoleToUser: (args: { userId: string; roleId: string }) =>
        convex.mutation((api as any).access.assignRoleToUser, {
          ...args,
          siteSlug: scope.siteSlug,
        } as any),
      setRoleForUser: (args: { userId: string; roleId?: string }) =>
        convex.mutation((api as any).access.setRoleForUser, {
          ...args,
          siteSlug: scope.siteSlug,
        } as any),
      setRoleForUsers: (args: { userIds: string[]; roleId?: string }) =>
        convex.mutation((api as any).access.setRoleForUsers, {
          ...args,
          siteSlug: scope.siteSlug,
        } as any),
      deleteUsers: (args: { userIds: string[] }) =>
        convex.mutation((api as any).access.deleteUsers, {
          ...args,
          siteSlug: scope.siteSlug,
        } as any),
      canUserAccessSlug: (args: { userId: string; slug: string }) =>
        convex.query((api as any).access.canUserAccessSlug, {
          ...args,
          siteSlug: scope.siteSlug,
        } as any),
    },
  };
}

export function siteDataFromRequest(
  request: { headers: Headers },
  client?: SiteConvexClient,
) {
  return createSiteData(siteScopeFromRequest(request), client);
}

export function siteDataFromSlug(siteSlug: string, client?: SiteConvexClient) {
  return createSiteData(siteScopeFromSlug(siteSlug), client);
}

export type SiteData = ReturnType<typeof createSiteData>;
