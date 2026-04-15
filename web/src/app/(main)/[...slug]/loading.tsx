export default function DocPageLoading() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-4 md:px-8 md:py-8">
        <div className="min-w-0 flex-1">
          <div className="mx-auto max-w-4xl animate-pulse space-y-4">
            {/* Title */}
            <div className="h-9 w-2/3 rounded-lg bg-[var(--sidebar-border)]" />
            {/* Paragraphs */}
            <div className="space-y-3 pt-4">
              <div className="h-4 w-full rounded bg-[var(--sidebar-border)]" />
              <div className="h-4 w-5/6 rounded bg-[var(--sidebar-border)]" />
              <div className="h-4 w-4/5 rounded bg-[var(--sidebar-border)]" />
            </div>
            <div className="space-y-3 pt-2">
              <div className="h-4 w-full rounded bg-[var(--sidebar-border)]" />
              <div className="h-4 w-3/4 rounded bg-[var(--sidebar-border)]" />
            </div>
            {/* Subheading */}
            <div className="h-7 w-1/3 rounded-lg bg-[var(--sidebar-border)] pt-4" />
            <div className="space-y-3 pt-2">
              <div className="h-4 w-full rounded bg-[var(--sidebar-border)]" />
              <div className="h-4 w-5/6 rounded bg-[var(--sidebar-border)]" />
              <div className="h-4 w-2/3 rounded bg-[var(--sidebar-border)]" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
