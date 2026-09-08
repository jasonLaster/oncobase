/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as access from "../access.js";
import type * as commentRooms from "../commentRooms.js";
import type * as conversations from "../conversations.js";
import type * as dicom from "../dicom.js";
import type * as documents from "../documents.js";
import type * as epicFhir from "../epicFhir.js";
import type * as guestNames from "../guestNames.js";
import type * as imageAnnotations from "../imageAnnotations.js";
import type * as lib_accessPolicy from "../lib/accessPolicy.js";
import type * as lib_assetVisibility from "../lib/assetVisibility.js";
import type * as lib_conversationAuth from "../lib/conversationAuth.js";
import type * as lib_manifestRevision from "../lib/manifestRevision.js";
import type * as lib_prefetchPriority from "../lib/prefetchPriority.js";
import type * as lib_serviceAuth from "../lib/serviceAuth.js";
import type * as lib_serviceFunctions from "../lib/serviceFunctions.js";
import type * as lib_site from "../lib/site.js";
import type * as manifestBuilder from "../manifestBuilder.js";
import type * as manifestCache from "../manifestCache.js";
import type * as migrations from "../migrations.js";
import type * as prefetch from "../prefetch.js";
import type * as sites from "../sites.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  access: typeof access;
  commentRooms: typeof commentRooms;
  conversations: typeof conversations;
  dicom: typeof dicom;
  documents: typeof documents;
  epicFhir: typeof epicFhir;
  guestNames: typeof guestNames;
  imageAnnotations: typeof imageAnnotations;
  "lib/accessPolicy": typeof lib_accessPolicy;
  "lib/assetVisibility": typeof lib_assetVisibility;
  "lib/conversationAuth": typeof lib_conversationAuth;
  "lib/manifestRevision": typeof lib_manifestRevision;
  "lib/prefetchPriority": typeof lib_prefetchPriority;
  "lib/serviceAuth": typeof lib_serviceAuth;
  "lib/serviceFunctions": typeof lib_serviceFunctions;
  "lib/site": typeof lib_site;
  manifestBuilder: typeof manifestBuilder;
  manifestCache: typeof manifestCache;
  migrations: typeof migrations;
  prefetch: typeof prefetch;
  sites: typeof sites;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
