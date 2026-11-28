// Production wiring for data.diana-tnbc.com. Loaded with import() from the
// Vercel HTML function and the standalone server, only for the data host.

import { createBackendClient } from "../backend-client";
import { dataOverlayConfigFromEnv, dataOverlayS3ConfigFromEnv } from "./config";
import { StorageNotConfiguredError, createDataOverlayHandler } from "./handler";
import { createConvexDataSessions } from "./sessions";
import type { DataOverlayStorage } from "./storage";

let handler: ReturnType<typeof createDataOverlayHandler> | undefined;
let storage: Promise<DataOverlayStorage> | undefined;

function loadStorage() {
  storage ??= (async () => {
    const s3 = dataOverlayS3ConfigFromEnv();
    if (!s3) throw new StorageNotConfiguredError();
    const { createS3StorageFromConfig } = await import("./storage");
    return createS3StorageFromConfig(s3);
  })().catch((error) => {
    storage = undefined;
    throw error;
  });
  return storage;
}

export function handleDataOverlayRequest(request: Request, rawPath: string | null) {
  if (!handler) {
    const config = dataOverlayConfigFromEnv();
    handler = createDataOverlayHandler({
      config,
      storage: loadStorage,
      sessions: createConvexDataSessions(createBackendClient(), config.siteSlug),
    });
  }
  return handler(request, rawPath);
}
