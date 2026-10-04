import { afterEach, describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import {
  RequestBodyTooLargeError,
  requestBodyTooLargeResponse,
  requestFromIncoming,
  restoreRewrittenPath,
  sendWebResponse,
} from "./http-adapter";

const servers: Server[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

async function listen(handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>) {
  const server = createServer((req, res) => {
    handler(req, res).catch((error) => {
      res.statusCode = 599;
      res.end(String(error));
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const until = async (condition: () => boolean, timeoutMs = 2000) => {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

describe("restoreRewrittenPath", () => {
  test("returns the same request when there is no rewrite", () => {
    const request = new Request("https://example.test/wiki/a?x=1");
    expect(restoreRewrittenPath(request)).toBe(request);
  });

  test("an empty rewrite (the site root) maps to /", () => {
    // vercel.json: "/(.*)" -> "/api/app-shell?__path=$1" yields __path= for "/".
    expect(restoreRewrittenPath(new Request("https://example.test/api/app-shell?__path=")).url)
      .toBe("https://example.test/");
  });

  test("restores API and page paths and keeps other query parameters", () => {
    expect(restoreRewrittenPath(new Request("https://example.test/api?__path=api/wiki/session&scope=public")).url)
      .toBe("https://example.test/api/wiki/session?scope=public");
    expect(restoreRewrittenPath(new Request("https://example.test/api/app-shell?__path=wiki/care/results")).url)
      .toBe("https://example.test/wiki/care/results");
  });

  test("collapses leading slashes so the result stays same-origin", () => {
    expect(restoreRewrittenPath(new Request("https://example.test/api?__path=//evil.test/x")).url)
      .toBe("https://example.test/evil.test/x");
  });

  test("preserves method, headers and body", async () => {
    const restored = restoreRewrittenPath(new Request("https://example.test/api?__path=api/login", {
      method: "POST", headers: { "content-type": "application/json" }, body: '{"password":"x"}',
    }));
    expect(restored.method).toBe("POST");
    expect(restored.headers.get("content-type")).toBe("application/json");
    expect(await restored.json()).toEqual({ password: "x" });
  });
});

describe("sendWebResponse", () => {
  test("keeps every Set-Cookie header", async () => {
    const origin = await listen(async (_req, res) => {
      const headers = new Headers({ "Content-Type": "text/plain" });
      headers.append("Set-Cookie", "a=1; Path=/; HttpOnly");
      headers.append("Set-Cookie", "b=2; Path=/");
      await sendWebResponse(res, new Response("ok", { headers }));
    });
    const response = await fetch(origin);
    expect(response.headers.getSetCookie()).toEqual(["a=1; Path=/; HttpOnly", "b=2; Path=/"]);
    expect(response.headers.get("content-type")).toBe("text/plain");
    expect(await response.text()).toBe("ok");
  });

  test("streams a large body completely", async () => {
    const chunk = new Uint8Array(256 * 1024).fill(7);
    const origin = await listen(async (_req, res) => {
      let sent = 0;
      await sendWebResponse(res, new Response(new ReadableStream({
        pull(controller) {
          if (sent++ === 32) controller.close();
          else controller.enqueue(chunk);
        },
      })));
    });
    const body = new Uint8Array(await (await fetch(origin)).arrayBuffer());
    expect(body.byteLength).toBe(32 * chunk.byteLength);
  });

  test("waits for drain before reading more of the body", async () => {
    const writes: number[] = [];
    let pulls = 0;
    const res = Object.assign(new EventEmitter(), {
      statusCode: 0, destroyed: false, writableFinished: false,
      setHeader() {},
      write(value: Uint8Array) { writes.push(value.byteLength); return false; },
      end() { this.writableFinished = true; },
    });
    const done = sendWebResponse(res as unknown as ServerResponse, new Response(new ReadableStream({
      pull(controller) {
        if (++pulls > 3) controller.close();
        else controller.enqueue(new Uint8Array(1));
      },
    }, { highWaterMark: 0 })));
    await until(() => writes.length === 1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(writes.length).toBe(1);
    res.emit("drain");
    await until(() => writes.length === 2);
    res.emit("drain");
    await until(() => writes.length === 3);
    res.emit("drain");
    await done;
    expect(res.writableFinished).toBe(true);
  });

  test("cancels the body when the client disconnects", async () => {
    let cancelled = false;
    const finished: Promise<void>[] = [];
    const origin = await listen(async (_req, res) => {
      const result = sendWebResponse(res, new Response(new ReadableStream({
        pull(controller) {
          controller.enqueue(new Uint8Array(64 * 1024));
          return new Promise((resolve) => setTimeout(resolve, 5));
        },
        cancel() { cancelled = true; },
      })));
      finished.push(result);
      await result;
    });
    const controller = new AbortController();
    const response = await fetch(origin, { signal: controller.signal });
    const reader = response.body!.getReader();
    await reader.read();
    controller.abort();
    await until(() => cancelled);
    await Promise.all(finished);
  });

  test("does not send or hold a body for 204 responses", async () => {
    let cancelled = false;
    const origin = await listen(async (_req, res) => {
      await sendWebResponse(res, new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 204 }));
    });
    const response = await fetch(origin);
    expect(response.status).toBe(204);
    await until(() => cancelled);
  });
});

describe("requestFromIncoming body limit", () => {
  const echo = (maxBodyBytes: number) => listen(async (req, res) => {
    try {
      const request = await requestFromIncoming(req, { maxBodyBytes });
      await sendWebResponse(res, new Response(`${(await request.arrayBuffer()).byteLength}`));
    } catch (error) {
      if (!(error instanceof RequestBodyTooLargeError)) throw error;
      await sendWebResponse(res, requestBodyTooLargeResponse());
    }
  });

  test("passes bodies at the limit through", async () => {
    const origin = await echo(1024);
    const response = await fetch(origin, { method: "POST", body: new Uint8Array(1024) });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("1024");
  });

  test("rejects a declared Content-Length over the limit with 413", async () => {
    const origin = await echo(1024);
    const response = await fetch(origin, { method: "POST", body: new Uint8Array(4096) });
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "Request body too large" });
  });

  test("rejects an undeclared (chunked) body once it exceeds the limit", async () => {
    const origin = await echo(1024);
    let sent = 0;
    const response = await fetch(origin, {
      method: "POST",
      body: new ReadableStream({
        pull(controller) {
          if (sent++ === 8) controller.close();
          else controller.enqueue(new Uint8Array(512));
        },
      }),
      duplex: "half",
    } as RequestInit);
    expect(response.status).toBe(413);
  });
});
