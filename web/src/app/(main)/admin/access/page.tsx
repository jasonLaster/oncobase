import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { siteDataFromRequest } from "@/lib/site-data";
import { getSessionUserFromCookieHeader } from "@/lib/session-user";
import { cookies, headers } from "next/headers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AccessRoleSelect } from "./access-role-select";

type AccessRole = {
  _id: string;
  name: string;
  permissions: string[];
};

type AccessUser = {
  _id: string;
  email: string;
  name: string | null;
  roles: string[];
  roleIds: string[];
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

async function createRole(formData: FormData) {
  "use server";
  const request = await getRequestContext();
  const user = await getSessionUserFromCookieHeader(
    request.cookieHeader,
    request.headers,
  );
  if (!user) redirect("/");

  const name = String(formData.get("name") ?? "").trim();
  const patterns = String(formData.get("patterns") ?? "").split(",").map((v) => v.trim()).filter(Boolean);
  if (!name || patterns.length === 0) return;
  await siteDataFromRequest(request).access.createRole({ name, pathPatterns: patterns });
  revalidatePath("/admin/access");
}

async function setUserRole(userId: string, roleId: string) {
  "use server";
  const request = await getRequestContext();
  const user = await getSessionUserFromCookieHeader(
    request.cookieHeader,
    request.headers,
  );
  if (!user) return { ok: false, error: "Sign in required" };

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
  const sessionUser = await getSessionUserFromCookieHeader(
    request.cookieHeader,
    request.headers,
  );
  if (!sessionUser) redirect("/");

  const siteData = siteDataFromRequest(request);
  const [users, roles] = (await Promise.all([
    siteData.access.listUsersWithRoles(),
    siteData.access.listRoles(),
  ])) as [AccessUser[], AccessRole[]];

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-8 p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Access Control</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {users.length} users, {roles.length} roles
          </p>
        </div>
      </header>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Roles
        </h2>
        <form
          action={createRole}
          className="grid gap-2 rounded-lg border border-border bg-background p-3 md:grid-cols-[minmax(12rem,16rem)_1fr_auto]"
        >
          <Input name="name" placeholder="Role name" required />
          <Input
            name="patterns"
            placeholder="sources/private/*, wiki/research/*"
            required
          />
          <Button type="submit">Create role</Button>
        </form>
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Role</th>
                <th className="px-3 py-2 font-medium">Path permissions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {roles.map((role) => (
                <tr key={role._id}>
                  <td className="w-64 px-3 py-2 font-medium">{role.name}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {role.permissions.join(", ") || "None"}
                  </td>
                </tr>
              ))}
              {roles.length === 0 && (
                <tr>
                  <td className="px-3 py-6 text-muted-foreground" colSpan={2}>
                    No roles
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Users
        </h2>
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-left text-sm">
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
    </main>
  );
}
