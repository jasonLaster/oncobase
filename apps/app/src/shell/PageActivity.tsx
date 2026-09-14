export function PageActivity({ label, busy = true }: { label: string; busy?: boolean }) {
  return <span role="status" className="reader-page-activity" data-test-id="page-activity" data-busy={busy}>
    <span className="reader-status-dot" aria-hidden="true" />{label}
  </span>;
}
