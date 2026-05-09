/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WIKI_API_ORIGIN?: string;
  readonly VITE_WIKI_APP_ORIGIN?: string;
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
