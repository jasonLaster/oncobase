import {
  BugIcon,
  ExternalLinkIcon,
  PowerIcon,
  PowerOffIcon,
  Trash2Icon,
  ZapIcon,
} from "lucide-react";
import { useStore } from "@livestore/react";
import { Button } from "@oncobase/ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@oncobase/ui/collapsible";
import type { WikiScope } from "@oncobase/wiki-content";
import { reloadWithLiveStoreDevtools } from "../livestore/devtools";
import { events } from "../livestore/schema";
import { emit } from "../reader-bus";
import type { Metrics } from "../types";
import { MetricsPanel } from "./MetricsPanel";
import { ScopeSwitcher } from "./Header";

function shortenStoreId(storeId: string) {
  if (storeId.length <= 34) return storeId;
  return `${storeId.slice(0, 18)}...${storeId.slice(-10)}`;
}

export function LiveStoreDevtoolsFooter({
  enabled,
  metrics,
  scope,
  storeId,
  visible,
}: {
  enabled: boolean;
  metrics: Metrics;
  scope: WikiScope;
  storeId: string;
  visible: boolean;
}) {
  const { store } = useStore();
  if (!visible) return null;

  const resetCache = () => {
    const confirmed = window.confirm(
      "Clear the local LiveStore cache for this reader and reload?",
    );
    if (!confirmed) return;

    store.commit(events.cacheResetRequested({ requestedAt: Date.now() }));
    window.location.reload();
  };
  const warmCache = () => emit("warm-cache");

  return (
    <footer
      className="livestore-devtools-footer"
      data-store-id={storeId}
      data-test-id="livestore-devtools-footer"
    >
      <Collapsible className="livestore-devtools-collapsible" defaultOpen>
        <CollapsibleTrigger className="livestore-devtools-summary">
          <BugIcon size={14} aria-hidden="true" />
          <span>LiveStore</span>
          <span className={`devtools-state ${enabled ? "enabled" : ""}`}>
            {enabled ? "devtools on" : "devtools off"}
          </span>
          <span className={`sync-dot ${metrics.status}`} />
          <span className="devtools-status">{metrics.message}</span>
        </CollapsibleTrigger>
        <CollapsiblePanel className="devtools-footer-panel" keepMounted>
          <ScopeSwitcher
            hash={window.location.hash}
            pathname={window.location.pathname}
            scope={scope}
            search={window.location.search}
          />
          <MetricsPanel metrics={metrics} />
          <span className="devtools-store" title={storeId}>
            Store {shortenStoreId(storeId)}
          </span>
          <Button className="devtools-action danger" onClick={resetCache}>
            <Trash2Icon size={14} aria-hidden="true" />
            <span>Reset cache</span>
          </Button>
          <Button className="devtools-action" data-test-id="warm-cache" onClick={warmCache}>
            <ZapIcon size={14} aria-hidden="true" />
            <span>Warm cache</span>
          </Button>
          {enabled ? (
            <a
              className="devtools-action"
              href="/_livestore"
              rel="noreferrer"
              target="_blank"
            >
              <ExternalLinkIcon size={14} aria-hidden="true" />
              <span>Open devtools</span>
            </a>
          ) : (
            <span className="devtools-note">Enable to attach the local cache session.</span>
          )}
          <Button className="devtools-action" onClick={() => reloadWithLiveStoreDevtools(!enabled)}>
            {enabled ? (
              <PowerOffIcon size={14} aria-hidden="true" />
            ) : (
              <PowerIcon size={14} aria-hidden="true" />
            )}
            <span>{enabled ? "Disable" : "Enable"}</span>
          </Button>
        </CollapsiblePanel>
      </Collapsible>
    </footer>
  );
}
