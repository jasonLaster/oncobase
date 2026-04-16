export default function ChatLoading() {
  return (
    <div className="flex items-center justify-center h-full text-sm text-[var(--text-muted)]">
      <span className="inline-block w-4 h-4 border-2 border-[var(--text-muted)] border-t-transparent rounded-full animate-spin mr-2" />
      Loading conversation...
    </div>
  );
}
