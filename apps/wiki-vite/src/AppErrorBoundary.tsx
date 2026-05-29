import { Component, type ErrorInfo, type ReactNode } from "react";

const SCOPE_STORAGE_KEY = "wiki-vite-scope";

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

    return (
      <main className="app-loading app-error app-auth-shell" data-test-id="app-recovery">
        <section>
          <h1>This reader hit a snag</h1>
          <p>
            The local wiki cache could not be opened. Resetting clears the offline
            copy stored in this browser and reloads the latest content.
          </p>
          <p className="auth-error">{error.message || String(error)}</p>
          <div className="auth-actions">
            <button
              type="button"
              data-test-id="app-recovery-reset"
              onClick={this.handleReset}
              disabled={resetting}
            >
              {resetting ? "Resetting…" : "Reset local data & reload"}
            </button>
            <button type="button" onClick={this.handleReload} disabled={resetting}>
              Reload
            </button>
          </div>
        </section>
      </main>
    );
  }
}
