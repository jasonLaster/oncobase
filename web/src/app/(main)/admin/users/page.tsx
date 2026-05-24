import type { Metadata } from "next";
import { AccessRoleSelect } from "../access/access-role-select";
import { setUserRole } from "../access/access-actions";
import { getAccessUsersAndRoles } from "../access/access-data";

export const metadata: Metadata = {
  title: "Admin Users",
};

export default async function AdminUsersPage() {
  const { users, roles } = await getAccessUsersAndRoles();

  return (
    <main className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 p-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {users.length} users, {roles.length} roles
          </p>
        </header>

        <section id="users" className="scroll-mt-6 space-y-3">
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
