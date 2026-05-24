"use client";

import { useMemo, useState, useTransition } from "react";
import { Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AccessRoleSelect } from "./access-role-select";

type RoleOption = {
  _id: string;
  name: string;
};

type AccessUser = {
  _id: string;
  email: string;
  name: string | null;
  roles: string[];
  roleIds: string[];
};

type SaveResult = {
  ok: boolean;
  error?: string;
};

export function AccessUsersTable({
  users,
  roles,
  onSaveUserRole,
  onBulkSetRole,
  onBulkDelete,
  currentUserId,
}: {
  users: AccessUser[];
  roles: RoleOption[];
  onSaveUserRole: (userId: string, roleId: string) => Promise<SaveResult>;
  onBulkSetRole: (userIds: string[], roleId: string) => Promise<SaveResult>;
  onBulkDelete: (userIds: string[]) => Promise<SaveResult>;
  currentUserId: string;
}) {
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [bulkRoleId, setBulkRoleId] = useState("");
  const [status, setStatus] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const selectableUserIds = useMemo(
    () => users.filter((user) => user._id !== currentUserId).map((user) => user._id),
    [currentUserId, users],
  );
  const selectedSet = useMemo(
    () => new Set(selectedUserIds),
    [selectedUserIds],
  );
  const selectedCount = selectedUserIds.length;
  const allSelected =
    selectableUserIds.length > 0 && selectedCount === selectableUserIds.length;
  const someSelected = selectedCount > 0 && !allSelected;

  function toggleAll(checked: boolean) {
    setSelectedUserIds(checked ? selectableUserIds : []);
  }

  function toggleUser(userId: string, checked: boolean) {
    setSelectedUserIds((current) =>
      checked
        ? Array.from(new Set([...current, userId]))
        : current.filter((id) => id !== userId),
    );
  }

  function saveBulkRole() {
    if (selectedCount === 0) return;
    setStatus("Saving");
    startTransition(() => {
      void (async () => {
        const result = await onBulkSetRole(selectedUserIds, bulkRoleId);
        if (result.ok) {
          setSelectedUserIds([]);
          setStatus("Saved");
          return;
        }
        setStatus(result.error ?? "Unable to save");
      })();
    });
  }

  function deleteSelectedUsers() {
    if (selectedCount === 0) return;
    setStatus("Deleting");
    startTransition(() => {
      void (async () => {
        const result = await onBulkDelete(selectedUserIds);
        if (result.ok) {
          setDeleteOpen(false);
          setSelectedUserIds([]);
          setStatus("Deleted");
          return;
        }
        setStatus(result.error ?? "Unable to delete");
      })();
    });
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Users
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <span
            aria-live="polite"
            className="min-w-24 text-sm text-muted-foreground"
          >
            {selectedCount > 0
              ? `${selectedCount} selected`
              : status || "No selection"}
          </span>
          <label className="sr-only" htmlFor="bulk-role">
            Role for selected users
          </label>
          <select
            id="bulk-role"
            value={bulkRoleId}
            disabled={isPending || selectedCount === 0}
            onChange={(event) => setBulkRoleId(event.currentTarget.value)}
            className="h-8 min-w-44 rounded-lg border border-input bg-background px-2.5 text-sm text-foreground outline-none transition-colors focus:border-ring focus:ring-3 focus:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-input/30"
          >
            <option value="">No role</option>
            {roles.map((role) => (
              <option key={role._id} value={role._id}>
                {role.name}
              </option>
            ))}
          </select>
          <Button
            type="button"
            variant="outline"
            disabled={isPending || selectedCount === 0}
            onClick={saveBulkRole}
          >
            Assign role
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={isPending || selectedCount === 0}
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2Icon aria-hidden="true" />
            Delete
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[780px] text-left text-sm">
          <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="w-12 px-3 py-2 font-medium">
                <label className="sr-only" htmlFor="select-all-users">
                  Select all users
                </label>
                <input
                  id="select-all-users"
                  type="checkbox"
                  checked={allSelected}
                  ref={(input) => {
                    if (input) input.indeterminate = someSelected;
                  }}
                  onChange={(event) => toggleAll(event.currentTarget.checked)}
                  className="size-4 rounded border-border text-primary"
                />
              </th>
              <th className="px-3 py-2 font-medium">User</th>
              <th className="px-3 py-2 font-medium">Email</th>
              <th className="px-3 py-2 font-medium">Role</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {users.map((user) => {
              const userLabel = user.name || user.email;
              const isCurrentUser = user._id === currentUserId;
              return (
                <tr key={user._id}>
                  <td className="px-3 py-2">
                    <label className="sr-only" htmlFor={`select-${user._id}`}>
                      Select {userLabel}
                    </label>
                    <input
                      id={`select-${user._id}`}
                      type="checkbox"
                      disabled={isCurrentUser}
                      checked={selectedSet.has(user._id)}
                      onChange={(event) =>
                        toggleUser(user._id, event.currentTarget.checked)
                      }
                      className="size-4 rounded border-border text-primary"
                    />
                  </td>
                  <td className="px-3 py-2 font-medium">{userLabel}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {user.email}
                  </td>
                  <td className="px-3 py-2">
                    <AccessRoleSelect
                      roles={roles}
                      userId={user._id}
                      userLabel={userLabel}
                      initialRoleId={user.roleIds[0] ?? ""}
                      onSave={onSaveUserRole}
                    />
                    {user.roles.length > 1 && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {user.roles.length} roles assigned; changing this
                        replaces them.
                      </p>
                    )}
                  </td>
                </tr>
              );
            })}
            {users.length === 0 && (
              <tr>
                <td className="px-3 py-6 text-muted-foreground" colSpan={4}>
                  No users
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete selected users</DialogTitle>
            <DialogDescription className="sr-only">
              Confirm user deletion
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This deletes {selectedCount} user{selectedCount === 1 ? "" : "s"} and
            revokes their sessions.
          </p>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={isPending}
              onClick={deleteSelectedUsers}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
