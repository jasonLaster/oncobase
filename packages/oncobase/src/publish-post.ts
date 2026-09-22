import { readErrorBody } from "./http";
import { publishProfile, type PublishProfile, type PublishPhase } from "./publish-profile";
import { PUBLISHER_PROTOCOL_VERSION, PUBLISHER_VERSION_HEADER } from "./version";

const steps = new Set(["begin", "document", "asset", "asset-hashes", "document-hashes", "finish", "abort", "sync/plan", "sync/documents", "sync/assets", "state", "scoped/begin", "scoped/abort", "scoped/finish", "status"]);

export async function publisherPost<T = unknown>(
  url: string, token: string, body: unknown,
  options: { profile?: PublishProfile; signal?: AbortSignal } = {},
): Promise<T> {
  const profile = options.profile ?? publishProfile;
  const step = new URL(url).pathname.split("/publish/")[1] ?? "other";
  const name = `http.${steps.has(step) ? step : "other"}` as PublishPhase;
  return profile.span(name, async () => {
    const payload = profile.sync("http.serialize", () => JSON.stringify(body));
    if (profile.enabled) profile.metric("requestBytes", Buffer.byteLength(payload));
    const traceparent = profile.traceparent();
    const response = await profile.span("http.headers", () => fetch(url, {
      method: "POST", signal: options.signal,
      headers: {
        "Content-Type": "application/json", Authorization: `Bearer ${token}`,
        [PUBLISHER_VERSION_HEADER]: String(PUBLISHER_PROTOCOL_VERSION),
        ...(traceparent ? { traceparent, "X-Publish-Profile": "1" } : {}),
      },
      body: payload,
    }));
    profile.metric("status", response.status);
    // Never save raw headers; record only fixed server timing fields.
    const timing = response.headers.get("server-timing") ?? "";
    for (const [field, metric] of [
      ["backend", "serverMs"], ["convex", "rpcSumMs"],
      ["phase-publish-auth", "authMs"], ["phase-publish-lock", "lockMs"],
      ["phase-publish-inventory-documents", "documentsInventoryMs"],
      ["phase-publish-inventory-assets", "assetsInventoryMs"],
      ["phase-publish-state", "stateMs"],
      ["phase-publish-reader", "readerMs"],
    ] as const) {
      const match = timing.match(new RegExp(`(?:^|,\\s*)${field};dur=([0-9.]+)`));
      if (match) profile.metric(metric, Number(match[1]));
    }
    const count = timing.match(/(?:^|,\s*)convex-count;desc="(\d+)"/);
    if (count) profile.metric("rpcCount", Number(count[1]));
    const raw = await profile.span("http.body", () => response.text());
    if (profile.enabled) profile.metric("responseBytes", Buffer.byteLength(raw));
    if (!response.ok) {
      if (response.status === 426) throw new Error(`${raw}\nUpdate @oncobase/oncobase, then retry.`);
      throw new Error(`${response.status} ${await readErrorBody(new Response(raw))}`);
    }
    const result = profile.sync("http.parse", () => JSON.parse(raw)) as T;
    if (profile.enabled && result && typeof result === "object" && "page" in result && Array.isArray(result.page)) {
      profile.metric("items", result.page.length);
    }
    return result;
  });
}
