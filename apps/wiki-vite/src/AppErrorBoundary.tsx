import { Component, type ErrorInfo, type ReactNode } from "react";

const SCOPE_STORAGE_KEY = "wiki-vite-scope";
const RELOAD_FLAG_KEY = "wiki-vite:reloaded-for-load-error";

const CHUNK_LOAD_ERROR_RE =
  /Unable to preload (?:CSS|module)|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|ChunkLoadError|Loading (?:CSS )?chunk/i;

export function isChunkLoadError(error: unknown): boolean {
  const message =
    error instanceof Error ? `${error.name} ${error.message}` : String(error ?? "");
  return CHUNK_LOAD_ERROR_RE.test(message);
}

// A deploy can leave an already-open tab referencing chunks/styles that fail to
// load. Reload once per tab session to pick up the current asset graph; the flag
// is intentionally never auto-cleared so a persistent failure can't loop.
export function reloadOnceForLoadError(): boolean {
  try {
    if (!window.sessionStorage.getItem(RELOAD_FLAG_KEY)) {
      window.sessionStorage.setItem(RELOAD_FLAG_KEY, "1");
      window.location.reload();
      return true;
    }
  } catch {
    // sessionStorage may be unavailable (private mode); skip the auto-reload.
  }
  return false;
}

export async function clearLocalWikiData(): Promise<void> {
  // LiveStore persists its SQLite database in OPFS. A store left behind by an
  // older schema version can fail to open, so clearing it lets the reader
  // rebuild a fresh cache from the API on the next load.
  try {
    const directory = await navigator.storage?.getDirectory?.();
    if (directory) {
      const handle = directory as FileSystemDirectoryHandle & {
        keys: () => AsyncIterableIterator<string>;
      };
      for await (const name of handle.keys()) {
        await directory.removeEntry(name, { recursive: true }).catch(() => {});
      }
    }
  } catch {
    // OPFS may be unavailable; fall through to the other stores.
  }

  try {
    const databases = (await indexedDB.databases?.()) ?? [];
    for (const database of databases) {
      if (database.name) indexedDB.deleteDatabase(database.name);
    }
  } catch {
    // Best effort: deleting IndexedDB is not supported everywhere.
  }

  try {
    window.localStorage.removeItem(SCOPE_STORAGE_KEY);
  } catch {
    // Ignore storage access errors (e.g. private mode).
  }
}

type Props = { children: ReactNode };
type State = { error: Error | null; resetting: boolean };

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null, resetting: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[wiki-vite] reader crashed", error, info.componentStack);
    if (isChunkLoadError(error)) reloadOnceForLoadError();
  }

  private handleReset = async () => {
    this.setState({ resetting: true });
    await clearLocalWikiData();
    window.location.reload();
  };

  private handleReload = () => {
    window.location.reload();
  };

  render() {
    const { error, resetting } = this.state;
    if (!error) return this.props.children;

    const chunkError = isChunkLoadError(error);
    const title = chunkError ? "The reader needs to reload" : "This reader hit a snag";
    const body = chunkError
      ? "Part of the app failed to load — usually because a newer version shipped while this tab was open. Reloading fetches the latest files."
      : "The local wiki cache could not be opened. Resetting clears the offline copy stored in this browser and reloads the latest content.";

    const reload = (
      <button type="button" data-test-id="app-recovery-reload" onClick={this.handleReload} disabled={resetting}>
        Reload
      </button>
    );
    const reset = (
      <button
        type="button"
        data-test-id="app-recovery-reset"
        onClick={this.handleReset}
        disabled={resetting}
      >
        {resetting ? "Resetting…" : "Reset local data & reload"}
      </button>
    );

    return (
      <main className="app-loading app-error app-auth-shell" data-test-id="app-recovery">
        <section>
          <h1>{title}</h1>
          <p>{body}</p>
          <p className="auth-error">{error.message || String(error)}</p>
          <div className="auth-actions">
            {chunkError ? reload : reset}
            {chunkError ? reset : reload}
          </div>
        </section>
      </main>
    );
  }
}
