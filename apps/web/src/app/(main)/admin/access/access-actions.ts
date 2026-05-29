"use server";

import { revalidatePath } from "next/cache";
import { siteDataFromRequest } from "@/lib/site-data";
import { getSessionUserWithAdminFromCookieHeader } from "@/lib/session-user";
import { getRequestContext } from "./access-data";

type RoleRuleValues = {
  name: string;
  description?: string;
  includePathPatterns?: string[];
  excludePathPatterns?: string[];
  includeTags?: string[];
  excludeTags?: string[];
  emailPatterns?: string[];
};

type SaveResult = {
  ok: boolean;
  error?: string;
};

async function requireAdminForAction(): Promise<
  | { ok: true; request: Awaited<ReturnType<typeof getRequestContext>> }
  | { ok: false; error: string }
> {
  const request = await getRequestContext();
  const user = await getSessionUserWithAdminFromCookieHeader(
    request.cookieHeader,
    request.headers,
  );
  if (!user?.isAdmin) return { ok: false, error: "Admin access required" };
  return { ok: true, request };
}

function revalidateAdminRoutes() {
  revalidatePath("/admin/pages");
  revalidatePath("/admin/roles");
  revalidatePath("/admin/users");
  revalidatePath("/admin/access");
}

export async function createRole(values: RoleRuleValues): Promise<SaveResult> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { ok: false, error: auth.error };

  try {
    const name = values.name.trim();
    const includePathPatterns = values.includePathPatterns ?? [];
    const includeTags = values.includeTags ?? [];
    if (!name || (includePathPatterns.length === 0 && includeTags.length === 0)) {
      return { ok: false, error: "Add an include path or include tag" };
    }

    await siteDataFromRequest(auth.request).access.createRole({
      name,
      description: values.description,
      includePathPatterns,
      excludePathPatterns: values.excludePathPatterns ?? [],
      includeTags,
      excludeTags: values.excludeTags ?? [],
      emailPatterns: values.emailPatterns ?? [],
    });
    revalidateAdminRoutes();
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to create role",
    };
  }
}

export async function updateRole(
  roleId: string,
  values: RoleRuleValues,
): Promise<SaveResult> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { ok: false, error: auth.error };

  try {
    const name = values.name.trim();
    const includePathPatterns = values.includePathPatterns ?? [];
    const includeTags = values.includeTags ?? [];
    if (!name || (includePathPatterns.length === 0 && includeTags.length === 0)) {
      return { ok: false, error: "Add an include path or include tag" };
    }
    await siteDataFromRequest(auth.request).access.updateRole({
      roleId,
      name,
      description: values.description,
      includePathPatterns,
      excludePathPatterns: values.excludePathPatterns ?? [],
      includeTags,
      excludeTags: values.excludeTags ?? [],
      emailPatterns: values.emailPatterns ?? [],
    });
    revalidateAdminRoutes();
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to save role",
    };
  }
}

export async function deleteRole(roleId: string): Promise<SaveResult> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { ok: false, error: auth.error };

  try {
    await siteDataFromRequest(auth.request).access.deleteRole({ roleId });
    revalidateAdminRoutes();
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to delete role",
    };
  }
}

export async function setUserRole(
  userId: string,
  roleId: string,
): Promise<SaveResult> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { ok: false, error: auth.error };

  try {
    await siteDataFromRequest(auth.request).access.setRoleForUser({
      userId,
      roleId: roleId || undefined,
    });
    revalidateAdminRoutes();
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to save role",
    };
  }
}

export async function setUsersRole(
  userIds: string[],
  roleId: string,
): Promise<SaveResult> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { ok: false, error: auth.error };

  try {
    if (userIds.length === 0) {
      return { ok: false, error: "Select at least one user" };
    }

    await siteDataFromRequest(auth.request).access.setRoleForUsers({
      userIds,
      roleId: roleId || undefined,
    });
    revalidateAdminRoutes();
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to save roles",
    };
  }
}

export async function deleteUsers(userIds: string[]): Promise<SaveResult> {
  const auth = await requireAdminForAction();
  if (!auth.ok) return { ok: false, error: auth.error };

  try {
    if (userIds.length === 0) {
      return { ok: false, error: "Select at least one user" };
    }

    const user = await getSessionUserWithAdminFromCookieHeader(
      auth.request.cookieHeader,
      auth.request.headers,
    );
    if (userIds.includes(user?._id ?? "")) {
      return { ok: false, error: "You cannot delete your own user" };
    }

    await siteDataFromRequest(auth.request).access.deleteUsers({ userIds });
    revalidateAdminRoutes();
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to delete users",
    };
  }
}
