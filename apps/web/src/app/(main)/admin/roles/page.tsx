import type { Metadata } from "next";
import {
  AccessRoleActions,
  AccessRoleCreateButton,
} from "../access/access-role-actions";
import { createRole, deleteRole, updateRole } from "../access/access-actions";
import { getAccessPagesData } from "../access/access-data";

export const metadata: Metadata = {
  title: "Admin Roles",
};

export default async function AdminRolesPage() {
  const { pages, roles } = await getAccessPagesData();

  return (
    <main className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 p-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Roles</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {roles.length} roles
            </p>
          </div>
          <AccessRoleCreateButton onCreate={createRole} pages={pages} />
        </header>

        <section id="roles" className="scroll-mt-6 space-y-3">
          <div className="overflow-x-auto rounded-lg border border-border">
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
                        pages={pages}
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
      </div>
    </main>
  );
}
