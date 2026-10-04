import type { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api.js";
import {
  createRole,
  deleteRole,
  deleteUsers,
  getAccessPagesData,
  getAccessUsersAndRoles,
  requireAdminUser,
  setUserRole,
  setUsersRole,
  updateRole,
} from "../admin-data.js";
import { getSessionUser, sessionTokenFromCookie, withSiteSlug } from "../reader-access";
import { hashSessionToken } from "../user-auth";
import { publicSessionUser } from "./common";

export async function requireAdminForRequest(
  request: Request,
  client: ConvexHttpClient,
  siteSlug: string,
) {
  return requireAdminUser({
    client,
    siteSlug,
    sessionUser: await getSessionUser(request, client, siteSlug),
  });
}

export async function handleAdminRequest(
  request: Request,
  client: ConvexHttpClient,
  siteSlug: string,
) {
  const adminUser = await requireAdminForRequest(request, client, siteSlug);
  if (!adminUser) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/api/admin/session") {
    return Response.json(
      {
        user: {
          _id: adminUser._id,
          ...publicSessionUser(adminUser),
        },
        isAdmin: true,
      },
      { headers: { "Cache-Control": "private, no-store", Vary: "Cookie, Host" } },
    );
  }

  if (request.method === "GET" && url.pathname === "/api/admin/access") {
    const view = url.searchParams.get("view");
    if (view === "users") {
      return Response.json(await getAccessUsersAndRoles(client, siteSlug), {
        headers: { "Cache-Control": "private, no-store", Vary: "Cookie, Host" },
      });
    }
    return Response.json(await getAccessPagesData(client, siteSlug), {
      headers: { "Cache-Control": "private, no-store", Vary: "Cookie, Host" },
    });
  }

  if (request.method === "POST" && url.pathname === "/api/admin/roles") {
    const body = await request.json();
    if (typeof body.roleId === "string") {
      return Response.json(await updateRole(client, siteSlug, body.roleId, body.values));
    }
    return Response.json(await createRole(client, siteSlug, body.values));
  }

  if (request.method === "DELETE" && url.pathname === "/api/admin/roles") {
    const body = await request.json();
    return Response.json(await deleteRole(client, siteSlug, String(body.roleId ?? "")));
  }

  if (request.method === "POST" && url.pathname === "/api/admin/users/role") {
    const body = await request.json();
    if (Array.isArray(body.userIds)) {
      return Response.json(
        await setUsersRole(
          client,
          siteSlug,
          body.userIds.map(String),
          typeof body.roleId === "string" ? body.roleId : undefined,
        ),
      );
    }
    return Response.json(
      await setUserRole(
        client,
        siteSlug,
        String(body.userId ?? ""),
        typeof body.roleId === "string" ? body.roleId : undefined,
      ),
    );
  }

  if (request.method === "DELETE" && url.pathname === "/api/admin/users") {
    const body = await request.json();
    return Response.json(
      await deleteUsers(
        client,
        siteSlug,
        Array.isArray(body.userIds) ? body.userIds.map(String) : [],
      ),
    );
  }

  if (request.method === "GET" && url.pathname.startsWith("/api/admin/pii/")) {
    const slug = decodeURIComponent(url.pathname.slice("/api/admin/pii/".length));
    const token = sessionTokenFromCookie(request.headers.get("cookie") ?? "");
    const page = await client.query(
      api.documents.getBySlug,
      withSiteSlug(siteSlug, {
        slug,
        includeSensitive: true,
        rawContentSessionTokenHash: token ? hashSessionToken(token) : undefined,
      }),
    );
    if (!page) return new Response("Not found", { status: 404 });
    return Response.json(page, {
      headers: { "Cache-Control": "private, no-store", Vary: "Cookie, Host" },
    });
  }

  return new Response("Not found", { status: 404 });
}
