import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useLocation } from "react-router";
import {
  classifyPage,
  listToText,
  textToList,
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
      <aside aria-label="Admin" className="admin-sidebar">
        <Link to="/admin/pages">Pages</Link>
        <Link to="/admin/users">Users</Link>
        <Link to="/admin/roles">Roles</Link>
      </aside>
      <main className="admin-main">{children}</main>
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
  const location = useLocation();
  const path = location.pathname;
  if (path === "/access" || path === "/admin/access") return <Navigate to="/admin/users" replace />;
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
        <p className="admin-muted">Manage the operational controls for the wiki.</p>
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
      </section>
    </AdminLayout>
  );
}

function AdminUsersPage() {
  const { data, error, reload } = useAccessData("users");
  const users = (data as UsersData | null)?.users ?? [];
  const roles = (data as UsersData | null)?.roles ?? [];
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkRoleId, setBulkRoleId] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
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
    setDeleteOpen(false);
    setStatus("Deleted");
    reload();
  }

  return (
    <AdminLayout>
      <section className="admin-section">
        <h1>Users</h1>
        <p className="admin-muted">{users.length} users, {roles.length} roles</p>
        {error ? <p className="admin-error">{error}</p> : null}
        <div className="admin-toolbar">
          <span aria-live="polite">{selected.length > 0 ? `${selected.length} selected` : status || "No selection"}</span>
          <label className="sr-only" htmlFor="bulk-role">Role for selected users</label>
          <select
            id="bulk-role"
            value={bulkRoleId}
            disabled={selected.length === 0}
            onChange={(event) => setBulkRoleId(event.currentTarget.value)}
          >
            <option value="">No role</option>
            {roles.map((role) => (
              <option key={role._id} value={role._id}>{role.name}</option>
            ))}
          </select>
          <button type="button" disabled={selected.length === 0} onClick={() => void saveBulkRole()}>Assign role</button>
          <button type="button" disabled={selected.length === 0} onClick={() => setDeleteOpen(true)}>Delete</button>
        </div>
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
                const isCurrentUser = user._id === currentUserId;
                return (
                  <tr key={user._id}>
                    <td>
                      <label className="sr-only" htmlFor={`select-${user._id}`}>Select {userLabel}</label>
                      <input
                        id={`select-${user._id}`}
                        type="checkbox"
                        disabled={isCurrentUser}
                        checked={selected.includes(user._id)}
                        onChange={(event) =>
                          setSelected((current) =>
                            event.currentTarget.checked
                              ? [...current, user._id]
                              : current.filter((id) => id !== user._id),
                          )
                        }
                      />
                    </td>
                    <td>{userLabel}</td>
                    <td>{user.email}</td>
                    <td>
                      <label className="sr-only" htmlFor={`role-${user._id}`}>Role for {userLabel}</label>
                      <select
                        id={`role-${user._id}`}
                        defaultValue={user.roleIds[0] ?? ""}
                        onChange={(event) => void saveUserRole(user._id, event.currentTarget.value)}
                      >
                        <option value="">No role</option>
                        {roles.map((role) => (
                          <option key={role._id} value={role._id}>{role.name}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      {deleteOpen ? (
        <div className="admin-modal-backdrop">
          <div role="dialog" aria-modal="true" aria-label="Delete selected users" className="admin-modal">
            <h2>Delete selected users</h2>
            <p>This deletes {selected.length} users and revokes their sessions.</p>
            <div className="admin-dialog-actions">
              <button type="button" onClick={() => setDeleteOpen(false)}>Cancel</button>
              <button type="button" onClick={() => void deleteSelected()}>Delete</button>
            </div>
          </div>
        </div>
      ) : null}
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
  const [createOpen, setCreateOpen] = useState(false);

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
          <button type="button" onClick={() => setCreateOpen(true)}>Create role</button>
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
      {createOpen ? (
        <RoleDialog
          title="Create role"
          pages={pages}
          initial={emptyRole()}
          onClose={() => setCreateOpen(false)}
          onSave={async (form) => {
            await apiJson<SaveResult>("/api/admin/roles", {
              method: "POST",
              body: JSON.stringify({ values: rolePayload(form) }),
            });
            setCreateOpen(false);
            reload();
          }}
        />
      ) : null}
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
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
    <>
      <tr>
        <td>{role.name}</td>
        <td>{role.includePathPatterns.join(", ") || "Any path"}</td>
        <td>{role.excludePathPatterns.join(", ") || "None"}</td>
        <td>{role.includeTags.join(", ") || "Any tag"}</td>
        <td>{role.excludeTags.join(", ") || "None"}</td>
        <td>{role.emailPatterns.join(", ") || "Manual"}</td>
        <td className="admin-action-cell">
          <button type="button" aria-label={`Actions for ${role.name}`} onClick={() => setMenuOpen((open) => !open)}>
            ...
          </button>
          {menuOpen ? (
            <div role="menu" className="admin-menu">
              <button role="menuitem" type="button" onClick={() => { setEditOpen(true); setMenuOpen(false); }}>Edit</button>
              <button role="menuitem" type="button" onClick={() => void onDelete(role._id)}>Delete</button>
            </div>
          ) : null}
        </td>
      </tr>
      {editOpen ? (
        <RoleDialog
          title="Edit role"
          pages={pages}
          initial={form}
          onClose={() => setEditOpen(false)}
          onSave={async (nextForm) => {
            await apiJson<SaveResult>("/api/admin/roles", {
              method: "POST",
              body: JSON.stringify({ roleId: role._id, values: rolePayload(nextForm) }),
            });
            setEditOpen(false);
            onSaved();
          }}
        />
      ) : null}
    </>
  );
}

function RoleDialog({
  title,
  pages,
  initial,
  onClose,
  onSave,
}: {
  title: string;
  pages: PreviewPage[];
  initial: ReturnType<typeof emptyRole>;
  onClose: () => void;
  onSave: (form: ReturnType<typeof emptyRole>) => Promise<void>;
}) {
  const [form, setForm] = useState(initial);
  const [tab, setTab] = useState<"rules" | "preview">("rules");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "included" | "excluded" | "unmatched">("all");
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
  const update = (key: keyof ReturnType<typeof emptyRole>, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  return (
    <div className="admin-modal-backdrop">
      <div role="dialog" aria-modal="true" aria-label={title} className="admin-modal admin-role-modal">
        <h2>{title}</h2>
        <div role="tablist" aria-label="Role editor" className="admin-tabs">
          <button role="tab" aria-selected={tab === "rules"} type="button" onClick={() => setTab("rules")}>Rules</button>
          <button role="tab" aria-selected={tab === "preview"} type="button" onClick={() => setTab("preview")}>Preview</button>
        </div>
        {tab === "rules" ? (
          <div className="admin-form-grid">
            <label>Role name<input value={form.name} onChange={(event) => update("name", event.currentTarget.value)} /></label>
            <label>Description<input value={form.description} onChange={(event) => update("description", event.currentTarget.value)} /></label>
            <label>Auto-assign emails<input value={form.emailPatterns} onChange={(event) => update("emailPatterns", event.currentTarget.value)} /></label>
            <label>Include paths<textarea value={form.includePathPatterns} onChange={(event) => update("includePathPatterns", event.currentTarget.value)} /></label>
            <label>Exclude paths<textarea value={form.excludePathPatterns} onChange={(event) => update("excludePathPatterns", event.currentTarget.value)} /></label>
            <label>Include tags<input value={form.includeTags} onChange={(event) => update("includeTags", event.currentTarget.value)} /></label>
            <label>Exclude tags<input value={form.excludeTags} onChange={(event) => update("excludeTags", event.currentTarget.value)} /></label>
          </div>
        ) : (
          <div className="admin-preview">
            <label><span className="sr-only">Filter pages</span><input value={query} placeholder="Filter pages or tags" onChange={(event) => setQuery(event.currentTarget.value)} /></label>
            <div className="admin-filter-row">
              {(["all", "included", "excluded", "unmatched"] as const).map((item) => (
                <button key={item} type="button" aria-pressed={filter === item} onClick={() => setFilter(item)}>
                  {item[0].toUpperCase() + item.slice(1)} {counts[item]}
                </button>
              ))}
            </div>
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
          </div>
        )}
        <div className="admin-dialog-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" disabled={!form.name.trim()} onClick={() => void onSave(form)}>Save</button>
        </div>
      </div>
    </div>
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
          <label><span className="sr-only">Search pages</span><input value={query} placeholder="Search pages, tags, roles" onChange={(event) => setQuery(event.currentTarget.value)} /></label>
          <label><span className="sr-only">Role</span><select value={roleId} onChange={(event) => setRoleId(event.currentTarget.value)}>
            <option value="all">All roles</option>
            {roles.map((role) => <option key={role._id} value={role._id}>{role.name}</option>)}
          </select></label>
        </div>
        <div className="admin-filter-row" role="radiogroup" aria-label="Page state">
          {(["all", "sensitive", "restricted", "excluded", "visible", "blocked"] as const).map((item) => (
            <button key={item} type="button" aria-pressed={state === item} onClick={() => setState(item)}>
              {item === "excluded" ? "Role-excluded" : item[0].toUpperCase() + item.slice(1)}
            </button>
          ))}
        </div>
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
