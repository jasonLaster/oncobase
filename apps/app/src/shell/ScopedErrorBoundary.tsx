import { Component, type ErrorInfo, type ReactNode } from "react";
import { isChunkLoadError } from "../AppErrorBoundary";
import { recordRenderError, type RenderErrorBoundary } from "../reader-telemetry";

type Props = {
  /** Telemetry scope; the error itself is never reported. */
  boundary: Exclude<RenderErrorBoundary, "root">;
  children: ReactNode;
  fallback: (retry: () => void) => ReactNode;
  /**
   * Let stale-deploy chunk failures reach the root boundary, which reloads the
   * tab once. Leaf boundaries keep them local so a failed optional chunk (for
   * example comments) degrades in place.
   */
  propagateChunkErrors?: boolean;
  /** Clears a caught error when it changes, e.g. on navigation. */
  resetKey?: unknown;
};
type State = { error: Error | null; resetKey: unknown };

/**
 * A render failure inside one region (route, article body, comments) must not
 * escalate to the root recovery card, whose action deletes the local cache.
 */
export class ScopedErrorBoundary extends Component<Props, State> {
  state: State = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return Object.is(props.resetKey, state.resetKey) ? null : { error: null, resetKey: props.resetKey };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (this.props.propagateChunkErrors && isChunkLoadError(error)) return;
    console.error(`[wiki-vite] ${this.props.boundary} render failed`, error, info.componentStack);
    recordRenderError(this.props.boundary);
  }

  private retry = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.propagateChunkErrors && isChunkLoadError(error)) throw error;
    return this.props.fallback(this.retry);
  }
}
