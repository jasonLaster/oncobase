export default function Loading() {
  return (
    <div className="h-full overflow-y-auto" role="status" aria-label="Loading chat">
      <div className="flex h-full flex-col gap-4 px-6 py-4 md:px-8 md:py-8">
        <div className="h-7 w-48 animate-pulse rounded-md bg-[var(--accent-light)]" />
        <div className="mt-auto space-y-3">
          <div className="h-16 w-2/3 animate-pulse rounded-lg bg-[var(--accent-light)]" />
          <div className="ml-auto h-16 w-1/2 animate-pulse rounded-lg bg-[var(--accent-light)]" />
          <div className="h-12 w-full animate-pulse rounded-lg bg-[var(--accent-light)]" />
        </div>
      </div>
    </div>
  );
}
