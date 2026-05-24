import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { siteDataFromRequest } from "@/lib/site-data";
import { getSessionUserWithAdminFromCookieHeader } from "@/lib/session-user";
import { cookies, headers } from "next/headers";
import { AccessRoleSelect } from "./access-role-select";
import { AccessRoleActions, AccessRoleCreateButton } from "./access-role-actions";

type AccessRole = {
  _id: string;
  name: string;
  description?: string | null;
  permissions: string[];
  pathPatterns?: string[];
  includePathPatterns?: string[];
  excludePathPatterns?: string[];
  includeTags?: string[];
  excludeTags?: string[];
  emailPatterns?: string[];
};

type AccessUser = {
  _id: string;
  email: string;
  name: string | null;
  roles: string[];
  roleIds: string[];
};

type AccessPreviewPage = {
  slug: string;
  title: string;
  tags: string[];
};

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

async function getRequestContext() {
  const [cookieStore, requestHeaders] = await Promise.all([
    cookies(),
    headers(),
  ]);
  const headerStore = new Headers(requestHeaders);
  const cookieHeader = cookieStore.toString();
  headerStore.set("cookie", cookieHeader);
  return { cookieHeader, headers: headerStore };
}

async function createRole(values: RoleRuleValues): Promise<SaveResult> {
  "use server";
  const request = await getRequestContext();
  const user = await getSessionUserWithAdminFromCookieHeader(
    request.cookieHeader,
    request.headers,
  );
  if (!user?.isAdmin) return { ok: false, error: "Admin access required" };

  try {
    const name = values.name.trim();
    const includePathPatterns = values.includePathPatterns ?? [];
    const includeTags = values.includeTags ?? [];
    if (!name || (includePathPatterns.length === 0 && includeTags.length === 0)) {
      return { ok: false, error: "Add an include path or include tag" };
    }

    await siteDataFromRequest(request).access.createRole({
      name,
      description: values.description,
      includePathPatterns,
      excludePathPatterns: values.excludePathPatterns ?? [],
      includeTags,
      excludeTags: values.excludeTags ?? [],
      emailPatterns: values.emailPatterns ?? [],
    });
    revalidatePath("/admin/access");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to create role",
    };
  }
}

async function updateRole(
  roleId: string,
  values: RoleRuleValues,
) {
  "use server";
  const request = await getRequestContext();
  const user = await getSessionUserWithAdminFromCookieHeader(
    request.cookieHeader,
    request.headers,
  );
  if (!user?.isAdmin) return { ok: false, error: "Admin access required" };

  try {
    const name = values.name.trim();
    const includePathPatterns = values.includePathPatterns ?? [];
    const includeTags = values.includeTags ?? [];
    if (!name || (includePathPatterns.length === 0 && includeTags.length === 0)) {
      return { ok: false, error: "Add an include path or include tag" };
    }
    await siteDataFromRequest(request).access.updateRole({
      roleId,
      name,
      description: values.description,
      includePathPatterns,
      excludePathPatterns: values.excludePathPatterns ?? [],
      includeTags,
      excludeTags: values.excludeTags ?? [],
      emailPatterns: values.emailPatterns ?? [],
    });
    revalidatePath("/admin/access");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to save role",
    };
  }
}

async function deleteRole(roleId: string) {
  "use server";
  const request = await getRequestContext();
  const user = await getSessionUserWithAdminFromCookieHeader(
    request.cookieHeader,
    request.headers,
  );
  if (!user?.isAdmin) return { ok: false, error: "Admin access required" };

  try {
    await siteDataFromRequest(request).access.deleteRole({ roleId });
    revalidatePath("/admin/access");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to delete role",
    };
  }
}

async function setUserRole(userId: string, roleId: string) {
  "use server";
  const request = await getRequestContext();
  const user = await getSessionUserWithAdminFromCookieHeader(
    request.cookieHeader,
    request.headers,
  );
  if (!user?.isAdmin) return { ok: false, error: "Admin access required" };

  try {
    await siteDataFromRequest(request).access.setRoleForUser({
      userId,
      roleId: roleId || undefined,
    });
    revalidatePath("/admin/access");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to save role",
    };
  }
}

export default async function AccessAdminPage() {
  const request = await getRequestContext();
  const sessionUser = await getSessionUserWithAdminFromCookieHeader(
    request.cookieHeader,
    request.headers,
  );
  if (!sessionUser?.isAdmin) redirect("/");

  const siteData = siteDataFromRequest(request);
  const [users, rawRoles, rawPreviewPages] = (await Promise.all([
    siteData.access.listUsersWithRoles(),
    siteData.access.listRoles(),
    siteData.documents.list({ includeSensitive: true }),
  ])) as [AccessUser[], AccessRole[], AccessPreviewPage[]];
  const roles = rawRoles.map((role) => ({
    ...role,
    includePathPatterns:
      role.includePathPatterns ?? role.pathPatterns ?? role.permissions ?? [],
    excludePathPatterns: role.excludePathPatterns ?? [],
    includeTags: role.includeTags ?? [],
    excludeTags: role.excludeTags ?? [],
    emailPatterns: role.emailPatterns ?? [],
  }));
  const previewPages = rawPreviewPages
    .map((page) => ({
      slug: page.slug,
      title: page.title,
      tags: page.tags ?? [],
    }))
    .sort((a, b) => a.slug.localeCompare(b.slug));

  return (
    <main className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 p-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Access Control</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {users.length} users, {roles.length} roles
            </p>
          </div>
        </header>

        <section id="roles" className="scroll-mt-6 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              Roles
            </h2>
            <AccessRoleCreateButton
              onCreate={createRole}
              pages={previewPages}
            />
          </div>
          <div
            data-testid="roles-table-scroll"
            className="overflow-x-auto rounded-lg border border-border"
          >
            <table className="min-w-[1120px] w-full text-left text-sm">
            <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Role</th>
                <th className="px-3 py-2 font-medium">Include paths</th>
                <th className="px-3 py-2 font-medium">Exclude paths</th>
                <th className="px-3 py-2 font-medium">Include tags</th>
                <th className="px-3 py-2 font-medium">Exclude tags</th>
                <th className="px-3 py-2 font-medium">Auto emails</th>
                <th className="w-12 px-3 py-2 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {roles.map((role) => (
                <tr key={role._id}>
                  <td className="w-64 px-3 py-2 font-medium">{role.name}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {role.includePathPatterns.join(", ") || "Any path"}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {role.excludePathPatterns.join(", ") || "None"}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {role.includeTags.join(", ") || "Any tag"}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {role.excludeTags.join(", ") || "None"}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {role.emailPatterns.join(", ") || "Manual"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <AccessRoleActions
                      role={role}
                      onUpdate={updateRole}
                      onDelete={deleteRole}
                      pages={previewPages}
                    />
                  </td>
                </tr>
              ))}
              {roles.length === 0 && (
                <tr>
                  <td className="px-3 py-6 text-muted-foreground" colSpan={7}>
                    No roles
                  </td>
                </tr>
              )}
            </tbody>
            </table>
          </div>
        </section>

        <section id="users" className="scroll-mt-6 space-y-3">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Users
          </h2>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="min-w-[720px] w-full text-left text-sm">
            <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">User</th>
                <th className="px-3 py-2 font-medium">Email</th>
                <th className="px-3 py-2 font-medium">Role</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users.map((user) => (
                <tr key={user._id}>
                  <td className="px-3 py-2 font-medium">
                    {user.name || user.email}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {user.email}
                  </td>
                  <td className="px-3 py-2">
                    <AccessRoleSelect
                      roles={roles}
                      userId={user._id}
                      userLabel={user.name || user.email}
                      initialRoleId={user.roleIds[0] ?? ""}
                      onSave={setUserRole}
                    />
                    {user.roles.length > 1 && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {user.roles.length} roles assigned; changing this replaces them.
                      </p>
                    )}
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td className="px-3 py-6 text-muted-foreground" colSpan={3}>
                    No users
                  </td>
                </tr>
              )}
            </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
