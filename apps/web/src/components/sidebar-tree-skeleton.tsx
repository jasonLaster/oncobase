const SKELETON_ROWS = [
  { key: "diagnostics", depth: 0, width: "64%" },
  { key: "index", depth: 0, width: "48%" },
  { key: "about", depth: 0, width: "70%" },
  { key: "about-overview", depth: 1, width: "58%" },
  { key: "about-journal", depth: 1, width: "44%" },
  { key: "sources", depth: 0, width: "76%" },
  { key: "wiki", depth: 0, width: "52%" },
  { key: "wiki-diagnostics", depth: 1, width: "68%" },
  { key: "wiki-treatment", depth: 1, width: "60%" },
];

function rowPadding(depth: number) {
  if (depth === 0) return 12;
  return 38 + (depth - 1) * 18;
}

export function SidebarTreeSkeleton() {
  return (
    <nav
      aria-label="Loading page tree"
      className="min-h-0 flex-1 select-none overflow-y-auto px-1.5 py-2"
      data-test-id="sidebar-tree"
    >
      <div aria-hidden="true" className="space-y-1">
        {SKELETON_ROWS.map((row) => (
          <div
            className="flex items-center gap-[10px] rounded-md"
            key={row.key}
            style={{
              height: 30,
              paddingLeft: rowPadding(row.depth),
              paddingRight: 8,
            }}
          >
            <span className="h-4 w-4 shrink-0 rounded bg-[var(--sidebar-border)]/80" />
            <span
              className="h-3 rounded bg-[var(--sidebar-border)]/80"
              style={{ width: row.width }}
            />
          </div>
        ))}
      </div>
    </nav>
  );
}
