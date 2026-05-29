import { AdminSidebar } from "./admin-sidebar";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 bg-background">
      <AdminSidebar />
      <div className="min-h-0 min-w-0 flex-1">{children}</div>
    </div>
  );
}
