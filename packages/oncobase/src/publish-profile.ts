import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import fs from "node:fs";

// Fixed names and numeric attributes only: profiles may leave a private vault.
export type PublishPhase =
  | "config" | "git.check" | "sync" | "scan.documents" | "scan.assets"
  | "manifest" | "plan" | "plan.recheck" | "verify.documents"
  | "metadata" | "embeddings" | "upload.documents" | "upload.assets"
  | "asset.read" | "asset.blob" | "asset.verify" | "http.serialize" | "http.headers"
  | "assets.inventory" | "assets.documents" | "assets.hash" | "assets.ownership"
  | "http.body" | "http.parse" | "http.begin" | "http.document"
  | "http.asset" | "http.asset-hashes" | "http.document-hashes"
  | "http.finish" | "http.abort" | "http.sync/plan"
  | "http.sync/documents" | "http.sync/assets" | "http.scoped/abort" | "http.scoped/finish" | "http.scoped/begin" | "http.status" | "http.state" | "http.other"
  | "verify.reader" | "state.lookup" | "embeddings.tokens" | "retry.cooldown" | "retry.tokens" | "retry.attempt";
export type ProfileMetric = "items" | "bytes" | "requestBytes" | "responseBytes" | "status"
  | "serverMs" | "rpcSumMs" | "rpcCount" | "authMs" | "lockMs"
  | "documentsInventoryMs" | "assetsInventoryMs" | "stateMs" | "readerMs" | "attempt";
type ProfileSpan = {
  id: string; parentId?: string; name: PublishPhase; startMs: number;
  durationMs?: number; outcome: "running" | "ok" | "error";
  metrics: Partial<Record<ProfileMetric, number>>;
};

export class PublishProfile {
  readonly traceId = randomBytes(16).toString("hex");
  private started = performance.now();
  private context = new AsyncLocalStorage<ProfileSpan>();
  private spans: ProfileSpan[] = [];
  private droppedSpans = 0;
  constructor(readonly enabled = false, private maxSpans = 100_000) {}

  private start(name: PublishPhase) {
    const span: ProfileSpan = {
      id: randomBytes(8).toString("hex"), parentId: this.context.getStore()?.id,
      name, startMs: performance.now() - this.started, outcome: "running", metrics: {},
    };
    if (this.spans.length < this.maxSpans) this.spans.push(span);
    else this.droppedSpans++;
    return span;
  }
  private end(span: ProfileSpan) {
    span.durationMs = performance.now() - this.started - span.startMs;
  }
  async span<T>(name: PublishPhase, run: () => T | Promise<T>): Promise<T> {
    if (!this.enabled) return run();
    const span = this.start(name);
    return this.context.run(span, async () => {
      try { const result = await run(); span.outcome = "ok"; return result; }
      catch (error) { span.outcome = "error"; throw error; }
      finally { this.end(span); }
    });
  }
  sync<T>(name: PublishPhase, run: () => T): T {
    if (!this.enabled) return run();
    const span = this.start(name);
    return this.context.run(span, () => {
      try { const result = run(); span.outcome = "ok"; return result; }
      catch (error) { span.outcome = "error"; throw error; }
      finally { this.end(span); }
    });
  }
  metric(key: ProfileMetric, value: number) {
    if (Number.isFinite(value)) {
      const span = this.context.getStore();
      if (span) span.metrics[key] = value;
    }
  }
  traceparent() {
    const span = this.context.getStore();
    return this.enabled && span ? `00-${this.traceId}-${span.id}-01` : undefined;
  }
  snapshot(exitCode?: number) {
    return {
      version: 1, traceId: this.traceId, durationMs: performance.now() - this.started,
      exitCode, droppedSpans: this.droppedSpans,
      spans: this.spans.map(span => ({ ...span, metrics: { ...span.metrics } })),
    };
    // Do not sum nested/overlapping span durations to estimate wall time.
  }
  write(file: string, exitCode?: number) {
    // Refuse replacement (including symlinks); trace files can be used as evidence.
    fs.writeFileSync(file, `${JSON.stringify(this.snapshot(exitCode), null, 2)}\n`, { mode: 0o600, flag: "wx" });
  }
}

let installed = false;
export let publishProfile = new PublishProfile();

/** Also available to temporary local publishers: no collector is required. */
export function installPublishProfile(file: string) {
  if (installed) throw new Error("Publish profiling is already installed");
  installed = true;
  publishProfile = new PublishProfile(true);
  // Synchronous exit reporting also captures process.exit(), failed preflight,
  // and normal handled signals. SIGKILL cannot be reported by any exit hook.
  process.once("exit", code => {
    const snapshot = publishProfile.snapshot(code);
    console.error(`Publish timing: ${(snapshot.durationMs / 1000).toFixed(2)}s, ${snapshot.spans.length} spans, exit ${code}.`);
    try { publishProfile.write(file, code); }
    catch { console.error("Could not save publish profile; choose a new writable --profile path."); }
  });
  return publishProfile;
}
