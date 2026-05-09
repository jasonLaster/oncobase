import {
  BugIcon,
  ExternalLinkIcon,
  PowerIcon,
  PowerOffIcon,
  Trash2Icon,
} from "lucide-react";
import { useStore } from "@livestore/react";
import { reloadWithLiveStoreDevtools } from "../livestore/devtools";
import { events } from "../livestore/schema";

function shortenStoreId(storeId: string) {
  if (storeId.length <= 34) return storeId;
  return `${storeId.slice(0, 18)}...${storeId.slice(-10)}`;
}

export function LiveStoreDevtoolsFooter({
  enabled,
  storeId,
}: {
  enabled: boolean;
  storeId: string;
}) {
  const { store } = useStore();
  const resetCache = () => {
    const confirmed = window.confirm(
      "Clear the local LiveStore cache for this reader and reload?",
    );
    if (!confirmed) return;

    store.commit(events.cacheResetRequested({ requestedAt: Date.now() }));
    window.location.reload();
  };

  return (
    <footer className="livestore-devtools-footer" data-test-id="livestore-devtools-footer">
      <details>
        <summary>
          <BugIcon size={14} aria-hidden="true" />
          <span>LiveStore</span>
          <span className={`devtools-state ${enabled ? "enabled" : ""}`}>
            {enabled ? "devtools on" : "devtools off"}
          </span>
        </summary>
        <div className="devtools-footer-panel">
          <span className="devtools-store" title={storeId}>
            Store {shortenStoreId(storeId)}
          </span>
          <button
            className="devtools-action danger"
            type="button"
            onClick={resetCache}
          >
            <Trash2Icon size={14} aria-hidden="true" />
            <span>Reset cache</span>
          </button>
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
          <button
            className="devtools-action"
            type="button"
            onClick={() => reloadWithLiveStoreDevtools(!enabled)}
          >
            {enabled ? (
              <PowerOffIcon size={14} aria-hidden="true" />
            ) : (
              <PowerIcon size={14} aria-hidden="true" />
            )}
            <span>{enabled ? "Disable" : "Enable"}</span>
          </button>
        </div>
      </details>
    </footer>
  );
}
