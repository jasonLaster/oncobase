"use client";

import { useEffect, useState, useTransition } from "react";

type RoleOption = {
  _id: string;
  name: string;
};

type SaveResult = {
  ok: boolean;
  error?: string;
};

export function AccessRoleSelect({
  roles,
  userId,
  userLabel,
  initialRoleId,
  onSave,
}: {
  roles: RoleOption[];
  userId: string;
  userLabel: string;
  initialRoleId: string;
  onSave: (userId: string, roleId: string) => Promise<SaveResult>;
}) {
  const [selectedRoleId, setSelectedRoleId] = useState(initialRoleId);
  const [lastSavedRoleId, setLastSavedRoleId] = useState(initialRoleId);
  const [status, setStatus] = useState("");
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setSelectedRoleId(initialRoleId);
    setLastSavedRoleId(initialRoleId);
  }, [initialRoleId]);

  function saveRole(nextRoleId: string) {
    setSelectedRoleId(nextRoleId);
    setStatus("Saving");
    startTransition(() => {
      void (async () => {
        const result = await onSave(userId, nextRoleId);
        if (result.ok) {
          setLastSavedRoleId(nextRoleId);
          setStatus("Saved");
          return;
        }
        setSelectedRoleId(lastSavedRoleId);
        setStatus(result.error ?? "Unable to save");
      })();
    });
  }

  return (
    <div className="flex min-w-44 items-center gap-2">
      <label className="sr-only" htmlFor={`role-${userId}`}>
        Role for {userLabel}
      </label>
      <select
        id={`role-${userId}`}
        value={selectedRoleId}
        disabled={isPending || roles.length === 0}
        onChange={(event) => saveRole(event.currentTarget.value)}
        className="h-8 w-full min-w-44 rounded-lg border border-input bg-background px-2.5 text-sm text-foreground outline-none transition-colors focus:border-ring focus:ring-3 focus:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-input/30"
      >
        <option value="">No role</option>
        {roles.map((role) => (
          <option key={role._id} value={role._id}>
            {role.name}
          </option>
        ))}
      </select>
      <span
        aria-live="polite"
        className="w-16 shrink-0 text-xs text-muted-foreground"
      >
        {isPending ? "Saving" : status}
      </span>
    </div>
  );
}
