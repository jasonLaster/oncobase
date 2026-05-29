"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Edit2Icon,
  MoreHorizontalIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  classifyPage,
  listToText,
  textToList,
  type PreviewPage,
  type PreviewStatus,
  type RoleRules,
} from "./access-rule-utils";

type Role = RoleRules & {
  _id: string;
  name: string;
  description?: string | null;
};

type SaveResult = {
  ok: boolean;
  error?: string;
};

const roleDialogContentClass =
  "top-4 bottom-4 max-h-none translate-y-0 grid-rows-[auto_minmax(0,1fr)_auto_auto] overflow-hidden sm:max-w-3xl";

function RoleRulesFields({
  name,
  setName,
  description,
  setDescription,
  includePathPatterns,
  setIncludePathPatterns,
  excludePathPatterns,
  setExcludePathPatterns,
  includeTags,
  setIncludeTags,
  excludeTags,
  setExcludeTags,
  emailPatterns,
  setEmailPatterns,
}: {
  name: string;
  setName: (value: string) => void;
  description: string;
  setDescription: (value: string) => void;
  includePathPatterns: string;
  setIncludePathPatterns: (value: string) => void;
  excludePathPatterns: string;
  setExcludePathPatterns: (value: string) => void;
  includeTags: string;
  setIncludeTags: (value: string) => void;
  excludeTags: string;
  setExcludeTags: (value: string) => void;
  emailPatterns: string;
  setEmailPatterns: (value: string) => void;
}) {
  return (
    <div className="grid gap-3">
      <label className="grid gap-1.5 text-sm font-medium">
        Role name
        <Input
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
        />
      </label>
      <label className="grid gap-1.5 text-sm font-medium">
        Description
        <Input
          value={description}
          onChange={(event) => setDescription(event.currentTarget.value)}
        />
      </label>
      <label className="grid gap-1.5 text-sm font-medium">
        Auto-assign emails
        <Input
          value={emailPatterns}
          onChange={(event) => setEmailPatterns(event.currentTarget.value)}
          placeholder="serova.bio, @serova.bio, name@example.com"
        />
      </label>
      <label className="grid gap-1.5 text-sm font-medium">
        Include paths
        <Textarea
          value={includePathPatterns}
          onChange={(event) => setIncludePathPatterns(event.currentTarget.value)}
          placeholder="sources/private/*, sources/research/*"
        />
      </label>
      <label className="grid gap-1.5 text-sm font-medium">
        Exclude paths
        <Textarea
          value={excludePathPatterns}
          onChange={(event) => setExcludePathPatterns(event.currentTarget.value)}
          placeholder="sources/private/public-summary"
        />
      </label>
      <label className="grid gap-1.5 text-sm font-medium">
        Include tags
        <Input
          value={includeTags}
          onChange={(event) => setIncludeTags(event.currentTarget.value)}
          placeholder="serova, echo, trial"
        />
      </label>
      <label className="grid gap-1.5 text-sm font-medium">
        Exclude tags
        <Input
          value={excludeTags}
          onChange={(event) => setExcludeTags(event.currentTarget.value)}
          placeholder="public-summary"
        />
      </label>
    </div>
  );
}

function RoleRulesPreview({
  pages,
  rules,
}: {
  pages: PreviewPage[];
  rules: RoleRules;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<PreviewStatus>("all");
  const rows = useMemo(
    () =>
      pages.map((page) => ({
        ...page,
        preview: classifyPage(page, rules),
      })),
    [pages, rules],
  );
  const counts = useMemo(
    () => ({
      all: rows.length,
      included: rows.filter((row) => row.preview.status === "included").length,
      excluded: rows.filter((row) => row.preview.status === "excluded").length,
      unmatched: rows.filter((row) => row.preview.status === "unmatched").length,
    }),
    [rows],
  );
  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (status !== "all" && row.preview.status !== status) return false;
      if (!needle) return true;
      return [row.title, row.slug, ...row.tags, ...(row.sensitiveInclude ?? [])]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [query, rows, status]);
  const filters: Array<{ value: PreviewStatus; label: string }> = [
    { value: "all", label: "All" },
    { value: "included", label: "Included" },
    { value: "excluded", label: "Excluded" },
    { value: "unmatched", label: "Unmatched" },
  ];

  return (
    <div className="grid gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <label className="relative block sm:w-72">
          <span className="sr-only">Filter pages</span>
          <SearchIcon className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            className="pl-8"
            placeholder="Filter pages or tags"
          />
        </label>
        <div
          className="flex flex-wrap gap-1"
          role="radiogroup"
          aria-label="Preview status"
        >
          {filters.map((filter) => (
            <Button
              key={filter.value}
              type="button"
              size="sm"
              variant={status === filter.value ? "secondary" : "ghost"}
              aria-pressed={status === filter.value}
              onClick={() => setStatus(filter.value)}
            >
              {filter.label}
              <span className="ml-1 text-xs text-muted-foreground">
                {counts[filter.value]}
              </span>
            </Button>
          ))}
        </div>
      </div>
      <div className="max-h-[min(52vh,32rem)] overflow-auto rounded-lg border border-border">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="sticky top-0 border-b border-border bg-background text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Page</th>
              <th className="px-3 py-2 font-medium">Tags</th>
              <th className="px-3 py-2 font-medium">Result</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filteredRows.map((row) => (
              <tr key={row.slug}>
                <td className="px-3 py-2 align-top">
                  <div className="font-medium">{row.title || row.slug}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {row.slug}
                  </div>
                </td>
                <td className="px-3 py-2 align-top text-xs text-muted-foreground">
                  {row.tags.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {row.tags.map((tag) => (
                        <span
                          key={`${row.slug}-${tag}`}
                          className="rounded border border-border px-1.5 py-0.5"
                        >
                          {tag}
                        </span>
                      ))}
                      {(row.sensitiveInclude ?? []).map((tag) => (
                        <span
                          key={`${row.slug}-sensitive-include-${tag}`}
                          className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-amber-900"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : row.sensitiveInclude?.length ? (
                    <div className="flex flex-wrap gap-1">
                      {row.sensitiveInclude.map((tag) => (
                        <span
                          key={`${row.slug}-sensitive-include-${tag}`}
                          className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-amber-900"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : (
                    "None"
                  )}
                </td>
                <td className="px-3 py-2 align-top">
                  <span
                    className={cn(
                      "inline-flex rounded border px-2 py-0.5 text-xs font-medium capitalize",
                      row.preview.status === "included" &&
                        "border-emerald-300 bg-emerald-50 text-emerald-800",
                      row.preview.status === "excluded" &&
                        "border-rose-300 bg-rose-50 text-rose-800",
                      row.preview.status === "unmatched" &&
                        "border-border bg-muted text-muted-foreground",
                    )}
                  >
                    {row.preview.status}
                  </span>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {row.preview.reasons.join(", ")}
                  </div>
                </td>
              </tr>
            ))}
            {filteredRows.length === 0 && (
              <tr>
                <td
                  className="px-3 py-8 text-center text-muted-foreground"
                  colSpan={3}
                >
                  No pages match
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RoleRuleModalBody({
  pages,
  name,
  setName,
  description,
  setDescription,
  includePathPatterns,
  setIncludePathPatterns,
  excludePathPatterns,
  setExcludePathPatterns,
  includeTags,
  setIncludeTags,
  excludeTags,
  setExcludeTags,
  emailPatterns,
  setEmailPatterns,
}: {
  pages: PreviewPage[];
  name: string;
  setName: (value: string) => void;
  description: string;
  setDescription: (value: string) => void;
  includePathPatterns: string;
  setIncludePathPatterns: (value: string) => void;
  excludePathPatterns: string;
  setExcludePathPatterns: (value: string) => void;
  includeTags: string;
  setIncludeTags: (value: string) => void;
  excludeTags: string;
  setExcludeTags: (value: string) => void;
  emailPatterns: string;
  setEmailPatterns: (value: string) => void;
}) {
  const [tab, setTab] = useState<"rules" | "preview">("rules");
  const rules = useMemo(
    () => ({
      includePathPatterns: textToList(includePathPatterns),
      excludePathPatterns: textToList(excludePathPatterns),
      includeTags: textToList(includeTags),
      excludeTags: textToList(excludeTags),
      emailPatterns: textToList(emailPatterns),
    }),
    [
      emailPatterns,
      excludePathPatterns,
      excludeTags,
      includePathPatterns,
      includeTags,
    ],
  );

  return (
    <div className="min-h-0 overflow-y-auto pr-1">
      <div className="grid gap-4">
      <div
        className="inline-flex w-fit rounded-lg border border-border bg-muted/30 p-1"
        role="tablist"
        aria-label="Role editor"
      >
        <Button
          type="button"
          size="sm"
          variant={tab === "rules" ? "secondary" : "ghost"}
          role="tab"
          aria-selected={tab === "rules"}
          onClick={() => setTab("rules")}
        >
          Rules
        </Button>
        <Button
          type="button"
          size="sm"
          variant={tab === "preview" ? "secondary" : "ghost"}
          role="tab"
          aria-selected={tab === "preview"}
          onClick={() => setTab("preview")}
        >
          Preview
        </Button>
      </div>
      {tab === "rules" ? (
        <RoleRulesFields
          name={name}
          setName={setName}
          description={description}
          setDescription={setDescription}
          includePathPatterns={includePathPatterns}
          setIncludePathPatterns={setIncludePathPatterns}
          excludePathPatterns={excludePathPatterns}
          setExcludePathPatterns={setExcludePathPatterns}
          includeTags={includeTags}
          setIncludeTags={setIncludeTags}
          excludeTags={excludeTags}
          setExcludeTags={setExcludeTags}
          emailPatterns={emailPatterns}
          setEmailPatterns={setEmailPatterns}
        />
      ) : (
        <RoleRulesPreview pages={pages} rules={rules} />
      )}
      </div>
    </div>
  );
}

function roleValues({
  name,
  description,
  includePathPatterns,
  excludePathPatterns,
  includeTags,
  excludeTags,
  emailPatterns,
}: {
  name: string;
  description: string;
  includePathPatterns: string;
  excludePathPatterns: string;
  includeTags: string;
  excludeTags: string;
  emailPatterns: string;
}) {
  return {
    name,
    description,
    includePathPatterns: textToList(includePathPatterns),
    excludePathPatterns: textToList(excludePathPatterns),
    includeTags: textToList(includeTags),
    excludeTags: textToList(excludeTags),
    emailPatterns: textToList(emailPatterns),
  };
}

export function AccessRoleCreateButton({
  onCreate,
  pages,
}: {
  onCreate: (values: RoleRules & { name: string; description?: string }) => Promise<SaveResult>;
  pages: PreviewPage[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [includePathPatterns, setIncludePathPatterns] = useState("");
  const [excludePathPatterns, setExcludePathPatterns] = useState("");
  const [includeTags, setIncludeTags] = useState("");
  const [excludeTags, setExcludeTags] = useState("");
  const [emailPatterns, setEmailPatterns] = useState("");
  const [status, setStatus] = useState("");
  const [isPending, startTransition] = useTransition();

  function reset() {
    setName("");
    setDescription("");
    setIncludePathPatterns("");
    setExcludePathPatterns("");
    setIncludeTags("");
    setExcludeTags("");
    setEmailPatterns("");
    setStatus("");
  }

  function createRole() {
    setStatus("Saving");
    startTransition(() => {
      void (async () => {
        const result = await onCreate(
          roleValues({
            name,
            description,
            includePathPatterns,
            excludePathPatterns,
            includeTags,
            excludeTags,
            emailPatterns,
          }),
        );
        if (result.ok) {
          reset();
          setOpen(false);
          router.refresh();
          return;
        }
        setStatus(result.error ?? "Unable to create");
      })();
    });
  }

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        <PlusIcon />
        Create role
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className={roleDialogContentClass}>
          <DialogHeader>
            <DialogTitle>Create role</DialogTitle>
            <DialogDescription className="sr-only">
              Create role rules
            </DialogDescription>
          </DialogHeader>
          <RoleRuleModalBody
            pages={pages}
            name={name}
            setName={setName}
            description={description}
            setDescription={setDescription}
            includePathPatterns={includePathPatterns}
            setIncludePathPatterns={setIncludePathPatterns}
            excludePathPatterns={excludePathPatterns}
            setExcludePathPatterns={setExcludePathPatterns}
            includeTags={includeTags}
            setIncludeTags={setIncludeTags}
            excludeTags={excludeTags}
            setExcludeTags={setExcludeTags}
            emailPatterns={emailPatterns}
            setEmailPatterns={setEmailPatterns}
          />
          <p aria-live="polite" className="min-h-4 text-xs text-muted-foreground">
            {isPending ? "Saving" : status}
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={isPending || !name.trim()} onClick={createRole}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function AccessRoleActions({
  role,
  onUpdate,
  onDelete,
  pages,
}: {
  role: Role;
  onUpdate: (
    roleId: string,
    values: RoleRules & { name: string; description?: string },
  ) => Promise<SaveResult>;
  onDelete: (roleId: string) => Promise<SaveResult>;
  pages: PreviewPage[];
}) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description ?? "");
  const [includePathPatterns, setIncludePathPatterns] = useState(
    listToText(role.includePathPatterns),
  );
  const [excludePathPatterns, setExcludePathPatterns] = useState(
    listToText(role.excludePathPatterns),
  );
  const [includeTags, setIncludeTags] = useState(listToText(role.includeTags));
  const [excludeTags, setExcludeTags] = useState(listToText(role.excludeTags));
  const [emailPatterns, setEmailPatterns] = useState(
    listToText(role.emailPatterns),
  );
  const [status, setStatus] = useState("");
  const [isPending, startTransition] = useTransition();

  function saveRole() {
    setStatus("Saving");
    startTransition(() => {
      void (async () => {
        const result = await onUpdate(role._id, {
          ...roleValues({
            name,
            description,
            includePathPatterns,
            excludePathPatterns,
            includeTags,
            excludeTags,
            emailPatterns,
          }),
        });
        if (result.ok) {
          setStatus("Saved");
          setEditOpen(false);
          router.refresh();
          return;
        }
        setStatus(result.error ?? "Unable to save");
      })();
    });
  }

  function deleteRole() {
    setStatus("Deleting");
    startTransition(() => {
      void (async () => {
        const result = await onDelete(role._id);
        if (result.ok) {
          setDeleteOpen(false);
          router.refresh();
          return;
        }
        setStatus(result.error ?? "Unable to delete");
      })();
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Actions for ${role.name}`}
            />
          }
        >
          <MoreHorizontalIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-36">
          <DropdownMenuItem onClick={() => setEditOpen(true)}>
            <Edit2Icon />
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2Icon />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className={roleDialogContentClass}>
          <DialogHeader>
            <DialogTitle>Edit role</DialogTitle>
            <DialogDescription className="sr-only">
              Edit role rules
            </DialogDescription>
          </DialogHeader>
          <RoleRuleModalBody
            pages={pages}
            name={name}
            setName={setName}
            description={description}
            setDescription={setDescription}
            includePathPatterns={includePathPatterns}
            setIncludePathPatterns={setIncludePathPatterns}
            excludePathPatterns={excludePathPatterns}
            setExcludePathPatterns={setExcludePathPatterns}
            includeTags={includeTags}
            setIncludeTags={setIncludeTags}
            excludeTags={excludeTags}
            setExcludeTags={setExcludeTags}
            emailPatterns={emailPatterns}
            setEmailPatterns={setEmailPatterns}
          />
          <p aria-live="polite" className="min-h-4 text-xs text-muted-foreground">
            {isPending ? "Saving" : status}
          </p>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditOpen(false)}
            >
              Cancel
            </Button>
            <Button type="button" disabled={isPending || !name.trim()} onClick={saveRole}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete role</DialogTitle>
            <DialogDescription className="sr-only">
              Confirm role deletion
            </DialogDescription>
          </DialogHeader>
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
              onClick={deleteRole}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
