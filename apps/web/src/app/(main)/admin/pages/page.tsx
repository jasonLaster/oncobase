import type { Metadata } from "next";
import { AccessPagesPanel } from "../access/access-pages-panel";
import { getAccessPagesData } from "../access/access-data";

export const metadata: Metadata = {
  title: "Admin Pages",
};

export default async function AdminPagesPage() {
  const { pages, roles, users } = await getAccessPagesData();

  return (
    <main className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-6">
        <h1 className="sr-only">Pages</h1>
        <AccessPagesPanel pages={pages} roles={roles} users={users} />
      </div>
    </main>
  );
}
