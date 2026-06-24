import { getConvexServerClient } from "@/lib/convex-server";
import {
  getSessionUserWithAdminFromRequest,
  type AdminSessionUser,
} from "@/lib/session-user";
import { siteSlugFromRequest } from "@/lib/site";
import type { Id } from "@convex/_generated/dataModel";
import {
  handleEpicAuthorizeRequest,
  handleEpicCallbackRequest,
  handleEpicSyncRequest,
} from "../../../wiki-vite/server/epic-fhir";

function asEpicAdminUser(user: AdminSessionUser | null) {
  if (!user?.isAdmin) return null;
  return {
    _id: user._id as Id<"users">,
    email: user.email,
    name: user.name,
  };
}

export async function handleNextEpicAuthorizeRequest(request: Request) {
  const client = getConvexServerClient();
  const siteSlug = siteSlugFromRequest(request);
  const adminUser = asEpicAdminUser(
    await getSessionUserWithAdminFromRequest(request),
  );
  return handleEpicAuthorizeRequest({
    request,
    client,
    siteSlug,
    adminUser,
  });
}

export async function handleNextEpicCallbackRequest(request: Request) {
  return handleEpicCallbackRequest({
    request,
    client: getConvexServerClient(),
    siteSlug: siteSlugFromRequest(request),
  });
}

export async function handleNextEpicSyncRequest(request: Request) {
  const client = getConvexServerClient();
  const siteSlug = siteSlugFromRequest(request);
  const adminUser = asEpicAdminUser(
    await getSessionUserWithAdminFromRequest(request),
  );
  return handleEpicSyncRequest({
    request,
    client,
    siteSlug,
    adminUser,
  });
}
