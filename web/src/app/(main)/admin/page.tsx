import type { Metadata } from "next";
import Link from "next/link";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  ArrowRightIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  UsersRoundIcon,
  type LucideIcon,
} from "lucide-react";
import { getSessionUserWithAdminFromCookieHeader } from "@/lib/session-user";

export const metadata: Metadata = {
  title: "Admin",
};

type AdminLink = {
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
};

const adminLinks: AdminLink[] = [
  {
    title: "Users",
    description: "Review signed-in accounts and assign the right role.",
    href: "/admin/access#users",
    icon: UsersRoundIcon,
  },
  {
    title: "Roles",
    description: "Create and edit path and tag based access rules.",
    href: "/admin/access#roles",
    icon: ShieldCheckIcon,
  },
  {
    title: "Access Control",
    description: "Open the full users, roles, and access rules table.",
    href: "/admin/access",
    icon: SlidersHorizontalIcon,
  },
];

async function requireSession() {
  const [cookieStore, requestHeaders] = await Promise.all([
    cookies(),
    headers(),
  ]);
  const headerStore = new Headers(requestHeaders);
  const cookieHeader = cookieStore.toString();
  headerStore.set("cookie", cookieHeader);

  const user = await getSessionUserWithAdminFromCookieHeader(
    cookieHeader,
    headerStore,
  );
  if (!user?.isAdmin) redirect("/");

  return user;
}

export default async function AdminPage() {
  await requireSession();

  return (
    <main className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Manage the operational controls for the wiki.
          </p>
        </header>

        <nav aria-label="Admin sections" className="grid gap-3 sm:grid-cols-2">
          {adminLinks.map((item) => {
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                className="group flex min-h-28 items-start gap-3 rounded-lg border border-border bg-background p-4 text-left transition-colors hover:border-primary/40 hover:bg-accent focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground group-hover:text-primary">
                  <Icon aria-hidden="true" className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-3">
                    <span className="font-medium">{item.title}</span>
                    <ArrowRightIcon
                      aria-hidden="true"
                      className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
                    />
                  </span>
                  <span className="mt-1 block text-sm leading-6 text-muted-foreground">
                    {item.description}
                  </span>
                </span>
              </Link>
            );
          })}
        </nav>
      </div>
    </main>
  );
}
