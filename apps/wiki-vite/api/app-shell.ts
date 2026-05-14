import type { IncomingMessage, ServerResponse } from "node:http";

export const config = {
  maxDuration: 60,
};

type VercelHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;
let runtimeHandler: Promise<VercelHandler> | null = null;
const runtimeHandlerPath = "../.vercel-functions/app-shell.mjs";

async function loadRuntimeHandler() {
  runtimeHandler ??= import(runtimeHandlerPath).then(
    (mod: { default: VercelHandler }) => mod.default,
  );
  return runtimeHandler;
}

export default async function wikiViteAppShell(req: IncomingMessage, res: ServerResponse) {
  const handler = await loadRuntimeHandler();
  return handler(req, res);
}
