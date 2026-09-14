/** Keep this markup aligned with the pre-JavaScript indicator in index.html. */
export function AppStarting({ stage }: { stage?: string }) {
  return (
    <div className="app-startup" role="status" aria-label="Launching Diana TNBC" data-test-id="app-starting" data-startup-stage={stage}>
      <span className="app-startup-mark" aria-hidden="true">D</span>
      <span>Launching Diana TNBC...</span>
    </div>
  );
}
