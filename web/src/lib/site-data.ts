import type { ConvexHttpClient } from "convex/browser";
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
        convex.query(api.documents.search, args),
      getBySlug: (args: SiteScopedArgs<typeof api.documents.getBySlug>) =>
        convex.query(api.documents.getBySlug, args),
      getById: (args: SiteScopedArgs<typeof api.documents.getById>) =>
        convex.query(api.documents.getById, args),
      list: () => convex.action(api.documents.list, {}),
      getByTag: (args: SiteScopedArgs<typeof api.documents.getByTag>) =>
        convex.action(api.documents.getByTag, args),
      listTags: () => convex.action(api.documents.listTags, {}),
      vectorSearch: (args: SiteScopedArgs<typeof api.documents.vectorSearch>) =>
        convex.action(api.documents.vectorSearch, args),
      embeddingStatusPage: (
        args: SiteScopedArgs<typeof api.documents.embeddingStatusPage>,
      ) => convex.query(api.documents.embeddingStatusPage, args),
      listPageWithContent: (
        args: SiteScopedArgs<typeof api.documents.listPageWithContent>,
      ) => convex.query(api.documents.listPageWithContent, args),
      listPageDescriptions: (
        args: SiteScopedArgs<typeof api.documents.listPageDescriptions>,
      ) => convex.query(api.documents.listPageDescriptions, args),
      listPdfAssets: () => convex.query(api.documents.listPdfAssets, {}),
      listFileAssets: () => convex.query(api.documents.listFileAssets, {}),
      listPdfAssetPathsPage: (
        args: SiteScopedArgs<typeof api.documents.listPdfAssetPathsPage>,
      ) => convex.query(api.documents.listPdfAssetPathsPage, args),
      listFileAssetPathsPage: (
        args: SiteScopedArgs<typeof api.documents.listFileAssetPathsPage>,
      ) => convex.query(api.documents.listFileAssetPathsPage, args),
      assetHashesPage: (
        args: SiteScopedArgs<typeof api.documents.assetHashesPage>,
      ) => convex.query(api.documents.assetHashesPage, args),
      getPdfAssetByPath: (
        args: SiteScopedArgs<typeof api.documents.getPdfAssetByPath>,
      ) => convex.query(api.documents.getPdfAssetByPath, args),
      getFileAssetByPath: (
        args: SiteScopedArgs<typeof api.documents.getFileAssetByPath>,
      ) => convex.query(api.documents.getFileAssetByPath, args),
      getMeta: (args: SiteScopedArgs<typeof api.documents.getMeta>) =>
        convex.query(api.documents.getMeta, args),
      setMeta: (args: SiteScopedArgs<typeof api.documents.setMeta>) =>
        convex.mutation(api.documents.setMeta, args),
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
