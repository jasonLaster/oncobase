import type { ApiRouteRequest } from "../api-routes";
import {
  handleEpicAuthorizeRequest,
  handleEpicCallbackRequest,
  handleEpicSyncRequest,
  isAdminSessionUser,
} from "../epic-fhir";
import { getSessionUser } from "../reader-access";

async function adminSessionUser({ request, client, siteSlug }: ApiRouteRequest) {
  const sessionUser = await getSessionUser(request, client, siteSlug);
  return (await isAdminSessionUser(client, siteSlug, sessionUser))
    ? sessionUser
    : null;
}

export async function handleEpicAuthorizeRoute(route: ApiRouteRequest) {
  const { request, client, siteSlug } = route;
  return handleEpicAuthorizeRequest({ request, client, siteSlug, adminUser: await adminSessionUser(route) });
}

export function handleEpicCallbackRoute({ request, client, siteSlug }: ApiRouteRequest) {
  return handleEpicCallbackRequest({ request, client, siteSlug });
}

export async function handleEpicSyncRoute(route: ApiRouteRequest) {
  const { request, client, siteSlug } = route;
  return handleEpicSyncRequest({ request, client, siteSlug, adminUser: await adminSessionUser(route) });
}
