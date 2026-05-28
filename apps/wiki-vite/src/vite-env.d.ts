/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WIKI_API_ORIGIN?: string;
  readonly VITE_WIKI_APP_ORIGIN?: string;
}

interface Window {
  __WIKI_VITE_OBSERVABILITY__?: {
    metrics?: import("./types").Metrics;
    search: Array<{
      query: string;
      mode: "text" | "ai";
      durationMs: number;
      resultCount: number;
      status: "ready" | "error";
      at: number;
    }>;
  };
}

declare module "*?worker" {
  const workerConstructor: {
    new (): Worker;
  };
  export default workerConstructor;
}

declare module "*?sharedworker" {
  const workerConstructor: {
    new (): SharedWorker;
  };
  export default workerConstructor;
}
