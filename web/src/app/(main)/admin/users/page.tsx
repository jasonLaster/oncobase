import type { Metadata } from "next";
import {
  deleteUsers,
  setUserRole,
  setUsersRole,
} from "../access/access-actions";
import { getAccessUsersAndRoles, requireAdminRequest } from "../access/access-data";
import { AccessUsersTable } from "../access/access-users-table";
import { getSessionUserWithAdminFromCookieHeader } from "@/lib/session-user";

export const metadata: Metadata = {
  title: "Admin Users",
};

export default async function AdminUsersPage() {
  const request = await requireAdminRequest();
  const sessionUser = await getSessionUserWithAdminFromCookieHeader(
    request.cookieHeader,
    request.headers,
  );
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
          <AccessUsersTable
            users={users}
            roles={roles}
            onSaveUserRole={setUserRole}
            onBulkSetRole={setUsersRole}
            onBulkDelete={deleteUsers}
            currentUserId={sessionUser?._id ?? ""}
          />
        </section>
      </div>
    </main>
  );
}
