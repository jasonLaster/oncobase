"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  FileLock2Icon,
  LayoutDashboardIcon,
  ShieldCheckIcon,
  UsersRoundIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const adminNavItems = [
  {
    href: "/admin",
    label: "Overview",
    icon: LayoutDashboardIcon,
  },
  {
    href: "/admin/pages",
    label: "Pages",
    icon: FileLock2Icon,
  },
  {
    href: "/admin/roles",
    label: "Roles",
    icon: ShieldCheckIcon,
  },
  {
    href: "/admin/users",
    label: "Users",
    icon: UsersRoundIcon,
  },
];

export function AdminSidebar() {
  const pathname = usePathname();

  return (
    <aside
      className="hidden w-60 shrink-0 border-r border-border bg-muted/20 md:flex md:flex-col"
      aria-label="Admin"
    >
      <div className="border-b border-border px-4 py-4">
        <Link
          href="/admin"
          className="text-sm font-semibold tracking-tight text-foreground"
        >
          Admin
        </Link>
      </div>
      <nav className="flex flex-1 flex-col gap-1 p-2" aria-label="Admin">
        {adminNavItems.map((item) => {
          const Icon = item.icon;
          const isActive =
            item.href === "/admin"
              ? pathname === "/admin"
              : pathname === item.href;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex h-9 items-center gap-2 rounded-md px-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                isActive && "bg-background text-foreground shadow-xs",
              )}
            >
              <Icon aria-hidden="true" className="size-4" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
