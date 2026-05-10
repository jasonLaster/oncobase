import type { Metrics } from "./types";

type SearchMetric = {
  query: string;
  mode: "text" | "ai";
  durationMs: number;
  resultCount: number;
  status: "ready" | "error";
  at: number;
};

type WikiViteObservability = {
  metrics?: Metrics;
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

export function recordSearchMetric(metric: Omit<SearchMetric, "at">) {
  const next = state();
  next.search = [...next.search, { ...metric, at: Date.now() }].slice(-20);
}
