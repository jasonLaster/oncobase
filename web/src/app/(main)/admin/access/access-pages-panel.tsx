"use client";

import { useMemo, useState } from "react";
import {
  EyeIcon,
  EyeOffIcon,
  FileLock2Icon,
  SearchIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  classifyPage,
  type PreviewPage,
  type RoleRules,
} from "./access-rule-utils";

type AccessRole = RoleRules & {
  _id: string;
  name: string;
  description?: string | null;
};

type AccessUser = {
  _id: string;
  email: string;
  name: string | null;
  roles: string[];
  roleIds: string[];
};

type PageState =
  | "all"
  | "sensitive"
  | "restricted"
  | "excluded"
  | "visible"
  | "blocked";

type RoleMatch = {
  role: AccessRole;
  reasons: string[];
};

type PageRow = PreviewPage & {
  includedRoles: RoleMatch[];
  excludedRoles: RoleMatch[];
  isRestricted: boolean;
  visibleUserIds: Set<string>;
};

const pageStateFilters: Array<{
  value: PageState;
  label: string;
  description: string;
}> = [
  {
    value: "all",
    label: "All",
    description: "Pages matching the active search, role, and user filters.",
  },
  {
    value: "sensitive",
    label: "Sensitive flag",
    description:
      "The source vault or published document row has sensitive=true. If only the source has it, the publish state is stale.",
  },
  {
    value: "restricted",
    label: "Role-gated",
    description:
      "At least one role rule includes this page, so a user needs a matching role to read it.",
  },
  {
    value: "excluded",
    label: "Role-excluded",
    description:
      "A role that includes broad content removes this page by an exclude path or exclude tag.",
  },
  {
    value: "visible",
    label: "Visible",
    description:
      "With all users selected, public unrestricted pages. With a user selected, pages that user can read.",
  },
  {
    value: "blocked",
    label: "Blocked",
    description:
      "Only applies after selecting a user: role-gated pages that user cannot read.",
  },
];

function pageMatchesUser(row: PageRow, userId: string) {
  return !row.isRestricted || row.visibleUserIds.has(userId);
}

function pageMatchesState(row: PageRow, state: PageState, userId: string) {
  if (state === "all") return true;
  if (state === "sensitive") return isSensitive(row);
  if (state === "restricted") return row.isRestricted;
  if (state === "excluded") return row.excludedRoles.length > 0;
  if (state === "visible") {
    return userId === "all"
      ? !isSensitive(row) && !row.isRestricted
      : pageMatchesUser(row, userId);
  }
  if (state === "blocked") {
    return userId !== "all" && !pageMatchesUser(row, userId);
  }
  return true;
}

function isSensitive(row: PreviewPage) {
  return row.sensitive === true || row.sourceSensitive === true;
}

function pageMatchesSearch(row: PageRow, query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;

  return [
    row.title,
    row.slug,
    ...row.tags,
    ...row.includedRoles.map((match) => match.role.name),
    ...row.excludedRoles.map((match) => match.role.name),
  ]
    .join(" ")
    .toLowerCase()
    .includes(needle);
}

function pageMatchesRole(row: PageRow, roleId: string) {
  if (roleId === "all") return true;
  return (
    row.includedRoles.some((match) => match.role._id === roleId) ||
    row.excludedRoles.some((match) => match.role._id === roleId)
  );
}

function pageMatchesUserFilter(row: PageRow, userId: string, state: PageState) {
  return userId === "all" || state === "blocked" || pageMatchesUser(row, userId);
}

function summarizeNames(values: string[], fallback: string) {
  if (values.length === 0) return fallback;
  if (values.length <= 2) return values.join(", ");
  return `${values
    .slice(0, 2)
    .join(", ")} +${values.length - 2}`;
}

function summarizeRoleMatches(values: RoleMatch[], fallback: string) {
  return summarizeNames(
    values.map((value) => {
      const reasons = value.reasons.join(", ");
      return reasons ? `${value.role.name} (${reasons})` : value.role.name;
    }),
    fallback,
  );
}

export function AccessPagesPanel({
  pages,
  roles,
  users,
}: {
  pages: PreviewPage[];
  roles: AccessRole[];
  users: AccessUser[];
}) {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<PageState>("all");
  const [roleId, setRoleId] = useState("all");
  const [userId, setUserId] = useState("all");

  const rows = useMemo<PageRow[]>(
    () =>
      pages.map((page) => {
        const matches = roles.map((role) => ({
          role,
          preview: classifyPage(page, role),
        }));
        const includedRoles = matches
          .filter((match) => match.preview.status === "included")
          .map((match) => ({
            role: match.role,
            reasons: match.preview.reasons,
          }));
        const excludedRoles = matches
          .filter((match) => match.preview.status === "excluded")
          .map((match) => ({
            role: match.role,
            reasons: match.preview.reasons,
          }));
        const includedRoleIds = new Set(
          includedRoles.map((match) => match.role._id),
        );
        const visibleUserIds = new Set(
          users
            .filter((user) =>
              user.roleIds.some((assignedRoleId) =>
                includedRoleIds.has(assignedRoleId),
              ),
            )
            .map((user) => user._id),
        );

        return {
          ...page,
          includedRoles,
          excludedRoles,
          isRestricted: includedRoles.length > 0,
          visibleUserIds,
        };
      }),
    [pages, roles, users],
  );

  const counts = useMemo(() => {
    const countFor = (nextState: PageState) =>
      rows.filter(
        (row) =>
          pageMatchesSearch(row, query) &&
          pageMatchesRole(row, roleId) &&
          pageMatchesUserFilter(row, userId, nextState) &&
          pageMatchesState(row, nextState, userId),
      ).length;
    return {
      all: countFor("all"),
      sensitive: countFor("sensitive"),
      restricted: countFor("restricted"),
      excluded: countFor("excluded"),
      visible: countFor("visible"),
      blocked: countFor("blocked"),
    };
  }, [query, roleId, rows, userId]);

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      if (!pageMatchesState(row, state, userId)) return false;
      if (!pageMatchesRole(row, roleId)) return false;
      if (!pageMatchesUserFilter(row, userId, state)) return false;
      return pageMatchesSearch(row, query);
    });
  }, [query, roleId, rows, state, userId]);

  return (
    <TooltipProvider>
      <section id="pages" className="min-h-full">
        <div className="sticky top-0 z-20 -mx-6 border-b border-border bg-background/95 px-6 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="grid gap-2">
            <label className="relative block">
              <span className="sr-only">Search pages</span>
              <SearchIcon className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                className="pl-8"
                placeholder="Search pages, tags, roles"
              />
            </label>
            <div className="grid gap-2 sm:grid-cols-2">
              <label>
                <span className="sr-only">Role</span>
                <select
                  value={roleId}
                  onChange={(event) => setRoleId(event.currentTarget.value)}
                  className="h-8 w-full rounded-lg border border-input bg-background px-2 text-sm text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <option value="all">All roles</option>
                  {roles.map((role) => (
                    <option key={role._id} value={role._id}>
                      {role.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="sr-only">User</span>
                <select
                  value={userId}
                  onChange={(event) => setUserId(event.currentTarget.value)}
                  className="h-8 w-full rounded-lg border border-input bg-background px-2 text-sm text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <option value="all">All users</option>
                  {users.map((user) => (
                    <option key={user._id} value={user._id}>
                      {user.name || user.email}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          <div
            className="mt-3 flex flex-wrap gap-1"
            role="radiogroup"
            aria-label="Page state"
          >
            {pageStateFilters.map((filter) => (
              <Tooltip key={filter.value}>
                <TooltipTrigger
                  render={
                    <Button
                      type="button"
                      size="sm"
                      variant={state === filter.value ? "secondary" : "ghost"}
                      aria-pressed={state === filter.value}
                      onClick={() => setState(filter.value)}
                    />
                  }
                >
                  {filter.label}
                  <span className="ml-1 text-xs text-muted-foreground">
                    {counts[filter.value]}
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  {filter.description}
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto py-4">
          <table className="w-full min-w-[920px] text-left text-sm">
            <thead className="border-b border-border bg-background text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Page</th>
                <th className="px-3 py-2 font-medium">State</th>
                <th className="px-3 py-2 font-medium">Included by</th>
                <th className="px-3 py-2 font-medium">Excluded by</th>
                <th className="px-3 py-2 font-medium">Users</th>
                <th className="px-3 py-2 font-medium">Tags</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredRows.map((row) => (
                <tr key={row.slug} className="align-top">
                  <td className="px-3 py-2">
                    <div className="font-medium">{row.title || row.slug}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {row.slug}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {row.sensitive ? (
                        <Badge variant="destructive">
                          <EyeOffIcon aria-hidden="true" />
                          Sensitive
                        </Badge>
                      ) : row.sourceSensitive ? (
                        <Badge variant="destructive">
                          <EyeOffIcon aria-hidden="true" />
                          Source sensitive
                        </Badge>
                      ) : (
                        <Badge variant="outline">
                          <EyeIcon aria-hidden="true" />
                          No sensitive flag
                        </Badge>
                      )}
                      {row.isRestricted ? (
                        <Badge variant="secondary">
                          <FileLock2Icon aria-hidden="true" />
                          Role-gated
                        </Badge>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {summarizeRoleMatches(row.includedRoles, "None")}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        "text-muted-foreground",
                        row.excludedRoles.length > 0 && "text-foreground",
                      )}
                    >
                      {summarizeRoleMatches(row.excludedRoles, "None")}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {row.isRestricted
                      ? `${row.visibleUserIds.size} users`
                      : "All users"}
                  </td>
                  <td className="px-3 py-2">
                    {row.tags.length > 0 ? (
                      <div className="flex max-w-80 flex-wrap gap-1">
                        {row.tags.slice(0, 6).map((tag) => (
                          <span
                            key={`${row.slug}-${tag}`}
                            className="rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground"
                          >
                            {tag}
                          </span>
                        ))}
                        {row.tags.length > 6 ? (
                          <span className="px-1.5 py-0.5 text-xs text-muted-foreground">
                            +{row.tags.length - 6}
                          </span>
                        ) : null}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">None</span>
                    )}
                  </td>
                </tr>
              ))}
              {filteredRows.length === 0 ? (
                <tr>
                  <td
                    className="px-3 py-8 text-center text-muted-foreground"
                    colSpan={6}
                  >
                    No pages match
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </TooltipProvider>
  );
}
