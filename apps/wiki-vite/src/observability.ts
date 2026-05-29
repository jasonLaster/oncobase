import type { Metrics } from "./types";
import type { ChatPerfEvent } from "@oncobase/chat/perf";

type SearchMetric = {
  query: string;
  mode: "text" | "ai";
  durationMs: number;
  resultCount: number;
  status: "ready" | "error";
  at: number;
};

type RuntimeMetric = {
  at: number;
  host: string;
  mode: string;
  vercelEnv?: string;
  commitSha?: string;
};

type WikiViteObservability = {
  chat?: {
    aborts: number;
    eventCount: number;
    lastEventType: string | null;
    lastUpdatedAt: number;
    streamEnds: number;
  };
  metrics?: Metrics;
  runtime?: RuntimeMetric;
  search: SearchMetric[];
};

function state(): WikiViteObservability {
  const target = window as typeof window & {
    __WIKI_VITE_OBSERVABILITY__?: WikiViteObservability;
  };
  target.__WIKI_VITE_OBSERVABILITY__ ??= { search: [] };
  return target.__WIKI_VITE_OBSERVABILITY__;
}

export function publishMetrics(metrics: Metrics) {
  state().metrics = metrics;
}

export function publishRuntimeEnvironment(runtime: Omit<RuntimeMetric, "at" | "host">) {
  state().runtime = {
    ...runtime,
    at: Date.now(),
    host: window.location.host,
  };
}

export function publishChatPerfSnapshot(events: ChatPerfEvent[]) {
  const next = state();
  next.chat = {
    aborts: events.filter((event) => event.type === "abort").length,
    eventCount: events.length,
    lastEventType: events.at(-1)?.type ?? null,
    lastUpdatedAt: Date.now(),
    streamEnds: events.filter((event) => event.type === "stream-end").length,
  };
}

export function recordSearchMetric(metric: Omit<SearchMetric, "at">) {
  const next = state();
  next.search = [...next.search, { ...metric, at: Date.now() }].slice(-20);
}
