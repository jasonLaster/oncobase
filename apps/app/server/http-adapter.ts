import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
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

async function readIncomingBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function requestFromIncoming(req: IncomingMessage) {
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
    body: hasBody ? await readIncomingBody(req) : undefined,
  });
}

export async function sendWebResponse(res: ServerResponse, response: Response) {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });

  if (response.body && response.status !== 204 && response.status !== 304) {
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
    } finally {
      reader.releaseLock();
    }
  }
  res.end();
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
