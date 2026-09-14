/** Keep this markup aligned with the pre-JavaScript indicator in index.html. */
export function AppStarting({ stage }: { stage?: string }) {
  return (
    <div className="app-startup" role="status" aria-label="Starting app" data-test-id="app-starting" data-startup-stage={stage}>
      <span className="app-startup-spinner" aria-hidden="true" />
      <span>Starting app…</span>
    </div>
  );
}
