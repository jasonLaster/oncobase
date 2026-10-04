import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";

// Vercel rejects Function request bodies above 4.5 MB before they reach us, so
// this only bounds memory where nothing else does (the Vite dev middleware and
// any self-hosted Node server). Publish batches are the largest legitimate JSON
// bodies; asset bytes go straight to Blob storage and never pass through here.
export const DEFAULT_MAX_REQUEST_BODY_BYTES = 64 * 1024 * 1024;

export class RequestBodyTooLargeError extends Error {
  readonly status = 413;
  constructor(readonly maxBytes: number) {
    super(`Request body exceeds ${maxBytes} bytes`);
    this.name = "RequestBodyTooLargeError";
  }
}

export function requestBodyTooLargeResponse() {
  return Response.json(
    { error: "Request body too large" },
    { status: 413, headers: { "Cache-Control": "private, no-store", Connection: "close" } },
  );
}

function headersFromIncoming(headers: IncomingHttpHeaders) {
  const output = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) output.append(key, item);
    } else if (value != null) {
      output.set(key, value);
    }
  }
  return output;
}

function readIncomingBody(req: IncomingMessage, maxBytes: number) {
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > maxBytes) {
    // Discard the unread body so the 413 can still be written on this socket.
    req.resume();
    return Promise.reject(new RequestBodyTooLargeError(maxBytes));
  }
  return new Promise<ReturnType<typeof Buffer.concat>>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    const cleanup = () => {
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("error", onError);
    };
    const onData = (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.length;
      if (total > maxBytes) {
        cleanup();
        chunks.length = 0;
        // Stop buffering but keep draining; destroying the request would
        // also destroy the socket and the client would never see the 413.
        req.resume();
        reject(new RequestBodyTooLargeError(maxBytes));
        return;
      }
      chunks.push(buffer);
    };
    const onEnd = () => {
      cleanup();
      resolve(Buffer.concat(chunks));
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
  });
}

export async function requestFromIncoming(
  req: IncomingMessage,
  { maxBodyBytes = DEFAULT_MAX_REQUEST_BODY_BYTES }: { maxBodyBytes?: number } = {},
) {
  const host = req.headers.host ?? "localhost";
  const forwardedProto = req.headers["x-forwarded-proto"];
  const protocol = Array.isArray(forwardedProto)
    ? forwardedProto[0]
    : forwardedProto || "http";
  const url = new URL(req.url ?? "/", `${protocol}://${host}`);
  const method = req.method ?? "GET";
  const hasBody = method !== "GET" && method !== "HEAD";
  return new Request(url, {
    method,
    headers: headersFromIncoming(req.headers),
    body: hasBody ? await readIncomingBody(req, maxBodyBytes) : undefined,
  });
}

/**
 * vercel.json rewrites every route to a function with the original path in
 * `?__path=`. Put it back so handlers see the URL the client requested. An
 * empty value (the rewrite of `/`) is the site root.
 */
export function restoreRewrittenPath(request: Request) {
  const url = new URL(request.url);
  const rewrittenPath = url.searchParams.get("__path");
  if (rewrittenPath == null) return request;

  url.pathname = `/${rewrittenPath.replace(/^\/+/, "")}`;
  url.searchParams.delete("__path");

  return new Request(url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    signal: request.signal,
    duplex: "half",
  } as RequestInit);
}

// Node emits "close" on the response when the client goes away mid-stream;
// Bun's node:http compatibility layer only closes the socket. Watch both.
function onDisconnect(res: ServerResponse, listener: () => void) {
  const socket = res.socket;
  res.on("close", listener);
  socket?.on("close", listener);
  return () => {
    res.off("close", listener);
    socket?.off("close", listener);
  };
}

function waitForDrainOrDisconnect(res: ServerResponse) {
  return new Promise<void>((resolve) => {
    const stopWatching = onDisconnect(res, () => done());
    const done = () => {
      res.off("drain", done);
      stopWatching();
      resolve();
    };
    res.on("drain", done);
  });
}

export async function sendWebResponse(res: ServerResponse, response: Response) {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    // Headers.forEach yields each Set-Cookie separately and setHeader would
    // keep only the last one. They are written together below.
    if (key !== "set-cookie") res.setHeader(key, value);
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) res.setHeader("Set-Cookie", cookies);

  const body = response.body;
  if (!body || response.status === 204 || response.status === 304 || res.destroyed) {
    await body?.cancel().catch(() => {});
    if (!res.destroyed) res.end();
    return;
  }

  const reader = body.getReader();
  let disconnected = false;
  // Stop producing (and abort any upstream fetch) once nobody is listening.
  const onClose = () => {
    if (res.writableFinished) return;
    disconnected = true;
    reader.cancel().catch(() => {});
  };
  const stopWatching = onDisconnect(res, onClose);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done || disconnected) break;
      if (!res.write(value)) await waitForDrainOrDisconnect(res);
      if (disconnected) break;
    }
  } catch (error) {
    if (!disconnected) throw error;
  } finally {
    stopWatching();
    reader.releaseLock();
  }
  if (!disconnected) res.end();
}
