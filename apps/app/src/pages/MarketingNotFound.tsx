import { ArrowRight } from "lucide-react";
import { PublicHeader } from "./PublicChrome";
import "./landing.css";
import "./features.css";

/** Shown when a visitor to oncobase.io follows a client-side link to a page that doesn't exist. */
export function MarketingNotFound() {
  return (
    <div className="landing-page ft-page" data-test-id="marketing-not-found">
      <div className="ft-root">
        <PublicHeader brand="oncobase" items={[]} navLabel="Page sections" />
        <main className="ft-hero lp-container" id="oncobase-main" style={{ minHeight: "60vh" }}>
          <h1>Page not found.</h1>
          <p className="ft-hero-lede">That page isn’t part of the Oncobase site.</p>
          <div className="ft-hero-actions">
            <a className="lp-button" href="/">
              Go to the home page <ArrowRight size={16} />
            </a>
            <a className="lp-text-link" href="/features">
              See the features <ArrowRight size={15} />
            </a>
          </div>
        </main>
      </div>
    </div>
  );
}
