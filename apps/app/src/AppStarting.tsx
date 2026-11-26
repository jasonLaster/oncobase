import { PageActivity } from "./shell/PageActivity";
import { currentSiteBrand } from "./site-host";

/** Only for JavaScript loading. The delayed reveal skips warm-load flashes. */
export function AppStarting({ stage }: { stage?: string }) {
  const brand = currentSiteBrand();
  return (
    <div className="app-startup" style={{ visibility: "hidden" }} role="status" aria-label={`Launching ${brand.label}`} data-test-id="app-starting" data-startup-stage={stage}>
      <span className="app-startup-mark" aria-hidden="true">{brand.initial}</span>
      <span>Launching {brand.label}...</span>
    </div>
  );
}

/** Code is ready; identity, storage or page data may still be pending. */
export function ReaderPending({ stage }: { stage?: string }) {
  return <div className="reader-pending" data-test-id="reader-pending" data-startup-stage={stage}>
    <PageActivity label="Loading page…" />
  </div>;
}
