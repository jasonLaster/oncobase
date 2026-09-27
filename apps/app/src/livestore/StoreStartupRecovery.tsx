import { useEffect } from "react";
import { dismissFirstFrameSnapshot } from "./first-frame-snapshot";

export default function StoreStartupRecovery() {
  useEffect(() => dismissFirstFrameSnapshot(), []);
  return (
    <main className="app-loading app-auth-shell" data-test-id="store-startup-recovery">
      <section>
        <h1>The reader could not finish opening</h1>
        <p>Check your connection and reload. If this continues, close and reopen this tab.</p>
        <div className="auth-actions">
          <button type="button" onClick={() => window.location.reload()}>Reload</button>
        </div>
      </section>
    </main>
  );
}
