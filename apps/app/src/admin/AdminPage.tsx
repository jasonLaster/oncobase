import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useLocation } from "react-router";
import { Check, ChevronsUpDown } from "lucide-react";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@oncobase/ui/alert-dialog";
import { Checkbox, CheckboxIndicator } from "@oncobase/ui/checkbox";
import {
  createDialogController,
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@oncobase/ui/dialog";
import { Field, FieldLabel } from "@oncobase/ui/field";
import { Input } from "@oncobase/ui/input";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@oncobase/ui/menu";
import { SegmentedControl, SegmentedControlItem } from "@oncobase/ui/segmented-control";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@oncobase/ui/select";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@oncobase/ui/tabs";
import { Textarea } from "@oncobase/ui/textarea";
import { Toolbar, ToolbarButton } from "@oncobase/ui/toolbar";
import { WikiPageLoading } from "@oncobase/wiki-shell/page-states";
import {
  classifyPage,
  listToText,
  textToList,
  type PreviewPage,
  type RoleRules,
} from "./access-rule-utils";
import { useWikiViteAuth } from "../shell/Header";
import { AdminStats } from "./AdminStats";

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

type AccessData = {
  pages: PreviewPage[];
  roles: AccessRole[];
  users: AccessUser[];
};

type UsersData = {
  users: AccessUser[];
  roles: AccessRole[];
};

type SaveResult = { ok: boolean; error?: string };

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (response.status === 401) {
    window.location.assign("/");
    throw new Error("Unauthorized");
  }
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as T;
}

function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="admin-shell">
      <div className="admin-main">{children}</div>
    </div>
  );
}

function useAccessData(view: "pages" | "users") {
  const [data, setData] = useState<AccessData | UsersData | null>(null);
  const [error, setError] = useState("");
  const reload = () => {
    void apiJson<AccessData | UsersData>(`/api/admin/access?view=${view}`)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  };
  useEffect(reload, [view]);
  return { data, error, reload };
}

export function AdminPage() {
  const { sessionLoading, sessionUser } = useWikiViteAuth();
  const location = useLocation();
  const path = location.pathname;

  if (sessionLoading) {
    return (
      <article
        className="page-shell page-shell-loading"
        data-test-id="admin-loading"
      >
        <WikiPageLoading includeTags={false} label="Loading admin" />
      </article>
    );
  }
  if (!sessionUser?.isAdmin) return <Navigate to="/" replace />;

  if (path === "/access") return <Navigate to="/admin/users" replace />;
  if (path === "/admin/access") return <Navigate to="/admin/pages" replace />;
  if (path === "/admin/users") return <AdminUsersPage />;
  if (path === "/admin/roles") return <AdminRolesPage />;
  if (path === "/admin/pages") return <AdminPagesPage />;
  return <AdminHomePage />;
}

function AdminHomePage() {
  return (
    <AdminLayout>
      <section className="admin-section">
        <h1>Admin</h1>
        <p className="admin-muted">What the wiki holds, and the controls for who can read it.</p>
        <nav aria-label="Admin sections" className="admin-card-grid">
          <Link to="/admin/pages" className="admin-card-link">
            <strong>Pages</strong>
            <span>Review hidden pages and role-based exclusions.</span>
          </Link>
          <Link to="/admin/users" className="admin-card-link">
            <strong>Users</strong>
            <span>Review signed-in accounts and assign the right role.</span>
          </Link>
          <Link to="/admin/roles" className="admin-card-link">
            <strong>Roles</strong>
            <span>Create and edit path and tag based access rules.</span>
          </Link>
        </nav>
        <AdminStats />
      </section>
    </AdminLayout>
  );
}

const NO_ROLE = "none";

function RoleSelect({ label, roles, value, defaultValue, disabled, onValueChange, toolbar }: {
  label: string;
  roles: AccessRole[];
  value?: string;
  defaultValue?: string;
  disabled?: boolean;
  onValueChange: (roleId: string) => void;
  toolbar?: boolean;
}) {
  const trigger = (
    <SelectTrigger aria-label={label} className="admin-select-trigger">
      <SelectValue />
      <ChevronsUpDown aria-hidden="true" size={14} />
    </SelectTrigger>
  );
  return (
    <Select
      value={value === undefined ? undefined : value || NO_ROLE}
      defaultValue={defaultValue === undefined ? undefined : defaultValue || NO_ROLE}
      disabled={toolbar ? undefined : disabled}
      onValueChange={(next) => onValueChange(!next || next === NO_ROLE ? "" : next)}
    >
      {toolbar ? <ToolbarButton disabled={disabled} render={trigger} /> : trigger}
      <SelectContent className="admin-select-content">
        <SelectItem value={NO_ROLE}>No role</SelectItem>
        {roles.map((role) => (
          <SelectItem key={role._id} value={role._id}>{role.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function AdminUsersPage() {
  const { data, error, reload } = useAccessData("users");
  const users = (data as UsersData | null)?.users ?? [];
  const roles = (data as UsersData | null)?.roles ?? [];
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkRoleId, setBulkRoleId] = useState("");
  const [status, setStatus] = useState("");
  const [currentUserId, setCurrentUserId] = useState("");

  useEffect(() => {
    void apiJson<{ user?: { _id?: string } }>("/api/admin/session")
      .then((session) => setCurrentUserId(session.user?._id ?? ""))
      .catch(() => {});
  }, []);

  async function saveUserRole(userId: string, roleId: string) {
    await apiJson<SaveResult>("/api/admin/users/role", {
      method: "POST",
      body: JSON.stringify({ userId, roleId }),
    });
    reload();
  }

  async function saveBulkRole() {
    await apiJson<SaveResult>("/api/admin/users/role", {
      method: "POST",
      body: JSON.stringify({ userIds: selected, roleId: bulkRoleId }),
    });
    setSelected([]);
    setStatus("Saved");
    reload();
  }

  async function deleteSelected() {
    await apiJson<SaveResult>("/api/admin/users", {
      method: "DELETE",
      body: JSON.stringify({ userIds: selected }),
    });
    setSelected([]);
    setStatus("Deleted");
    reload();
  }

  const nothingSelected = selected.length === 0;
  return (
    <AdminLayout>
      <section className="admin-section">
        <h1>Users</h1>
        <p className="admin-muted">{users.length} users, {roles.length} roles</p>
        {error ? <p className="admin-error">{error}</p> : null}
        <Toolbar aria-label="Selected users" className="admin-toolbar">
          <span aria-live="polite">{selected.length > 0 ? `${selected.length} selected` : status || "No selection"}</span>
          <RoleSelect
            toolbar
            label="Role for selected users"
            roles={roles}
            value={bulkRoleId}
            disabled={nothingSelected}
            onValueChange={setBulkRoleId}
          />
          <ToolbarButton disabled={nothingSelected} onClick={() => void saveBulkRole()}>Assign role</ToolbarButton>
          <AlertDialog>
            <ToolbarButton disabled={nothingSelected} render={<AlertDialogTrigger />}>Delete</ToolbarButton>
            <AlertDialogContent className="admin-modal">
              <AlertDialogTitle>Delete selected users</AlertDialogTitle>
              <AlertDialogDescription>This deletes {selected.length} users and revokes their sessions.</AlertDialogDescription>
              <div className="admin-dialog-actions">
                <AlertDialogClose>Cancel</AlertDialogClose>
                <AlertDialogClose
                  value="confirm"
                  action={deleteSelected}
                  data-agent-confirm="Deletes the selected users and revokes their sessions"
                >
                  Delete
                </AlertDialogClose>
              </div>
            </AlertDialogContent>
          </AlertDialog>
        </Toolbar>
        <div className="admin-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Select</th>
                <th>User</th>
                <th>Email</th>
                <th>Role</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const userLabel = user.name || user.email;
                return (
                  <tr key={user._id}>
                    <td>
                      <Checkbox
                        aria-label={`Select ${userLabel}`}
                        className="admin-checkbox"
                        disabled={user._id === currentUserId}
                        checked={selected.includes(user._id)}
                        onCheckedChange={(checked) => {
                          setSelected((current) =>
                            checked === true
                              ? [...current, user._id]
                              : current.filter((id) => id !== user._id),
                          );
                        }}
                      >
                        <CheckboxIndicator aria-hidden="true"><Check size={12} strokeWidth={3} /></CheckboxIndicator>
                      </Checkbox>
                    </td>
                    <td>{userLabel}</td>
                    <td>{user.email}</td>
                    <td>
                      <RoleSelect
                        label={`Role for ${userLabel}`}
                        roles={roles}
                        defaultValue={user.roleIds[0] ?? ""}
                        onValueChange={(roleId) => void saveUserRole(user._id, roleId)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </AdminLayout>
  );
}

function emptyRole() {
  return {
    name: "",
    description: "",
    includePathPatterns: "",
    excludePathPatterns: "",
    includeTags: "",
    excludeTags: "",
    emailPatterns: "",
  };
}

function rolePayload(form: ReturnType<typeof emptyRole>) {
  return {
    name: form.name,
    description: form.description,
    includePathPatterns: textToList(form.includePathPatterns),
    excludePathPatterns: textToList(form.excludePathPatterns),
    includeTags: textToList(form.includeTags),
    excludeTags: textToList(form.excludeTags),
    emailPatterns: textToList(form.emailPatterns),
  };
}

function AdminRolesPage() {
  const { data, error, reload } = useAccessData("pages");
  const pages = (data as AccessData | null)?.pages ?? [];
  const roles = (data as AccessData | null)?.roles ?? [];

  async function deleteRole(roleId: string) {
    await apiJson<SaveResult>("/api/admin/roles", {
      method: "DELETE",
      body: JSON.stringify({ roleId }),
    });
    reload();
  }

  return (
    <AdminLayout>
      <section className="admin-section" id="roles">
        <header className="admin-heading-row">
          <div>
            <h1>Roles</h1>
            <p className="admin-muted">{roles.length} roles</p>
          </div>
          <Dialog>
            <DialogTrigger>Create role</DialogTrigger>
            <RoleDialogContent
              title="Create role"
              pages={pages}
              initial={emptyRole()}
              onSave={async (form) => {
                await apiJson<SaveResult>("/api/admin/roles", {
                  method: "POST",
                  body: JSON.stringify({ values: rolePayload(form) }),
                });
                reload();
              }}
            />
          </Dialog>
        </header>
        {error ? <p className="admin-error">{error}</p> : null}
        <div className="admin-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Role</th>
                <th>Include paths</th>
                <th>Exclude paths</th>
                <th>Include tags</th>
                <th>Exclude tags</th>
                <th>Auto emails</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {roles.map((role) => (
                <RoleRow
                  key={role._id}
                  role={role}
                  pages={pages}
                  onDelete={deleteRole}
                  onSaved={reload}
                />
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </AdminLayout>
  );
}

function RoleRow({
  role,
  pages,
  onDelete,
  onSaved,
}: {
  role: AccessRole;
  pages: PreviewPage[];
  onDelete: (roleId: string) => Promise<void>;
  onSaved: () => void;
}) {
  const [edit] = useState(() => createDialogController());
  const form = {
    name: role.name,
    description: role.description ?? "",
    includePathPatterns: listToText(role.includePathPatterns),
    excludePathPatterns: listToText(role.excludePathPatterns),
    includeTags: listToText(role.includeTags),
    excludeTags: listToText(role.excludeTags),
    emailPatterns: listToText(role.emailPatterns),
  };
  return (
    <tr>
      <td>{role.name}</td>
      <td>{role.includePathPatterns.join(", ") || "Any path"}</td>
      <td>{role.excludePathPatterns.join(", ") || "None"}</td>
      <td>{role.includeTags.join(", ") || "Any tag"}</td>
      <td>{role.excludeTags.join(", ") || "None"}</td>
      <td>{role.emailPatterns.join(", ") || "Manual"}</td>
      <td className="admin-action-cell">
        <Menu onAction={(value) => (value === "edit" ? void edit.open() : onDelete(role._id))}>
          <MenuTrigger aria-label={`Actions for ${role.name}`}>...</MenuTrigger>
          <MenuContent className="admin-menu" align="end">
            <MenuItem value="edit">Edit</MenuItem>
            <MenuItem value="delete" destructive>Delete</MenuItem>
          </MenuContent>
        </Menu>
        <Dialog controller={edit}>
          <RoleDialogContent
            title="Edit role"
            pages={pages}
            initial={form}
            onSave={async (nextForm) => {
              await apiJson<SaveResult>("/api/admin/roles", {
                method: "POST",
                body: JSON.stringify({ roleId: role._id, values: rolePayload(nextForm) }),
              });
              onSaved();
            }}
          />
        </Dialog>
      </td>
    </tr>
  );
}

type RoleForm = ReturnType<typeof emptyRole>;
type PreviewFilter = "all" | "included" | "excluded" | "unmatched";

const ROLE_FIELDS: { key: keyof RoleForm; label: string; multiline?: boolean }[] = [
  { key: "name", label: "Role name" },
  { key: "description", label: "Description" },
  { key: "emailPatterns", label: "Auto-assign emails" },
  { key: "includePathPatterns", label: "Include paths", multiline: true },
  { key: "excludePathPatterns", label: "Exclude paths", multiline: true },
  { key: "includeTags", label: "Include tags" },
  { key: "excludeTags", label: "Exclude tags" },
];

function RoleDialogContent({ title, ...props }: {
  title: string;
  pages: PreviewPage[];
  initial: RoleForm;
  onSave: (form: RoleForm) => Promise<void>;
}) {
  return (
    <DialogContent className="admin-modal admin-role-modal">
      <DialogTitle>{title}</DialogTitle>
      <RoleEditor {...props} />
    </DialogContent>
  );
}

function RoleEditor({ pages, initial, onSave }: {
  pages: PreviewPage[];
  initial: RoleForm;
  onSave: (form: RoleForm) => Promise<void>;
}) {
  const [form, setForm] = useState(initial);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<PreviewFilter>("all");
  const rules = rolePayload(form);
  const previewRows = pages.map((page) => ({ ...page, preview: classifyPage(page, rules) }));
  const visibleRows = previewRows.filter((row) => {
    if (filter !== "all" && row.preview.status !== filter) return false;
    const needle = query.trim().toLowerCase();
    return !needle || [row.title, row.slug, ...row.tags].join(" ").toLowerCase().includes(needle);
  });
  const counts = {
    all: previewRows.length,
    included: previewRows.filter((row) => row.preview.status === "included").length,
    excluded: previewRows.filter((row) => row.preview.status === "excluded").length,
    unmatched: previewRows.filter((row) => row.preview.status === "unmatched").length,
  };
  const update = (key: keyof RoleForm, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  return (
    <>
      <Tabs defaultValue="rules">
        <TabsList aria-label="Role editor" className="admin-tabs">
          <TabsTab value="rules">Rules</TabsTab>
          <TabsTab value="preview">Preview</TabsTab>
        </TabsList>
        <TabsPanel value="rules" className="admin-form-grid">
          {ROLE_FIELDS.map(({ key, label, multiline }) => (
            <Field key={key} className="admin-field">
              <FieldLabel>{label}</FieldLabel>
              {multiline ? (
                <Textarea value={form[key]} onValueChange={(value) => update(key, value)} />
              ) : (
                <Input value={form[key]} onValueChange={(value) => update(key, value)} />
              )}
            </Field>
          ))}
        </TabsPanel>
        <TabsPanel value="preview" className="admin-preview">
          <Field className="admin-field">
            <FieldLabel className="sr-only">Filter pages</FieldLabel>
            <Input type="search" value={query} placeholder="Filter pages or tags" onValueChange={setQuery} />
          </Field>
          <SegmentedControl
            aria-label="Preview filter"
            className="admin-filter-row"
            value={filter}
            onValueChange={(value) => setFilter((value as PreviewFilter | null) ?? "all")}
          >
            {(["all", "included", "excluded", "unmatched"] as const).map((item) => (
              <SegmentedControlItem key={item} value={item}>
                {item[0].toUpperCase() + item.slice(1)} {counts[item]}
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
          <div className="admin-table-wrap admin-preview-table">
            <table>
              <tbody>
                {visibleRows.map((row) => (
                  <tr key={row.slug}>
                    <td><strong>{row.title || row.slug}</strong><small>{row.slug}</small></td>
                    <td>{row.tags.join(", ") || "None"}</td>
                    <td>{row.preview.status}</td>
                  </tr>
                ))}
                {visibleRows.length === 0 ? <tr><td colSpan={3}>No pages match</td></tr> : null}
              </tbody>
            </table>
          </div>
        </TabsPanel>
      </Tabs>
      <div className="admin-dialog-actions">
        <DialogClose>Cancel</DialogClose>
        <DialogClose disabled={!form.name.trim()} action={() => onSave(form)}>Save</DialogClose>
      </div>
    </>
  );
}

type PageState = "all" | "sensitive" | "restricted" | "excluded" | "visible" | "blocked";

function AdminPagesPage() {
  const { data, error } = useAccessData("pages");
  const pages = (data as AccessData | null)?.pages ?? [];
  const roles = (data as AccessData | null)?.roles ?? [];
  const users = (data as AccessData | null)?.users ?? [];
  const [query, setQuery] = useState("");
  const [state, setState] = useState<PageState>("all");
  const [roleId, setRoleId] = useState("all");

  const rows = useMemo(() => {
    return pages.map((page) => {
      const matches = roles.map((role) => ({ role, preview: classifyPage(page, role) }));
      const includedRoles = matches.filter((match) => match.preview.status === "included");
      const excludedRoles = matches.filter((match) => match.preview.status === "excluded");
      return {
        ...page,
        includedRoles,
        excludedRoles,
        isRestricted: includedRoles.length > 0,
        searchText: [page.title, page.slug, ...page.tags].join(" "),
      };
    });
  }, [pages, roles]);

  const selectedRole = roles.find((role) => role._id === roleId) ?? null;
  const filtered = rows.filter((row) => {
    const roleIncluded = selectedRole && row.includedRoles.some((match) => match.role._id === selectedRole._id);
    const roleExcluded = selectedRole && row.excludedRoles.some((match) => match.role._id === selectedRole._id);
    if (state === "sensitive" && !(row.sensitive || row.sourceSensitive)) return false;
    if (state === "restricted" && !row.isRestricted) return false;
    if (state === "excluded" && (selectedRole ? !roleExcluded : row.excludedRoles.length === 0)) return false;
    if (state === "visible" && selectedRole && row.isRestricted && !roleIncluded) return false;
    if (state === "blocked" && selectedRole && (!row.isRestricted || roleIncluded)) return false;
    if (selectedRole && state === "all" && !roleIncluded && !roleExcluded && row.isRestricted) return false;
    const needle = query.trim().toLowerCase();
    return !needle || row.searchText.toLowerCase().includes(needle);
  });

  return (
    <AdminLayout>
      <section className="admin-section" id="pages">
        <h1>Pages</h1>
        {error ? <p className="admin-error">{error}</p> : null}
        <div className="admin-toolbar admin-pages-toolbar">
          <Field className="admin-field admin-search-field">
            <FieldLabel className="sr-only">Search pages</FieldLabel>
            <Input type="search" value={query} placeholder="Search pages, tags, roles" onValueChange={setQuery} />
          </Field>
          <Select value={roleId} onValueChange={(value) => setRoleId(value ?? "all")}>
            <SelectTrigger aria-label="Role" className="admin-select-trigger">
              <SelectValue />
              <ChevronsUpDown aria-hidden="true" size={14} />
            </SelectTrigger>
            <SelectContent className="admin-select-content">
              <SelectItem value="all">All roles</SelectItem>
              {roles.map((role) => <SelectItem key={role._id} value={role._id}>{role.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <SegmentedControl
          aria-label="Page state"
          className="admin-filter-row"
          value={state}
          onValueChange={(value) => setState((value as PageState | null) ?? "all")}
        >
          {(["all", "sensitive", "restricted", "excluded", "visible", "blocked"] as const).map((item) => (
            <SegmentedControlItem key={item} value={item}>
              {item === "excluded" ? "Role-excluded" : item[0].toUpperCase() + item.slice(1)}
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
        <div className="admin-table-wrap">
          <table>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.slug}>
                  <td><strong>{row.title || row.slug}</strong><small>{row.slug}</small></td>
                  <td>{row.sensitive ? "Sensitive" : row.sourceSensitive ? "Source sensitive" : "No sensitive flag"} {row.isRestricted ? "Role-gated" : ""} {selectedRole && !row.isRestricted ? `Visible to ${selectedRole.name}` : ""}</td>
                  <td>{row.includedRoles.map((match) => match.role.name).join(", ") || "None"}</td>
                  <td>{row.excludedRoles.map((match) => match.role.name).join(", ") || "None"}</td>
                  <td>{row.isRestricted ? `${users.filter((user) => user.roleIds.some((id) => row.includedRoles.some((match) => match.role._id === id))).length} users` : "All users"}</td>
                </tr>
              ))}
              {filtered.length === 0 ? <tr><td colSpan={5}>No pages match</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    </AdminLayout>
  );
}
