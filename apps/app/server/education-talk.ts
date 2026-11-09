import { talkSessionConfig } from "@oncobase/education/talk";

const REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";
const MAX_SDP_BYTES = 64 * 1024;
const WINDOW_MS = 10 * 60_000;

/** Opens an OpenAI Realtime call for a reader's browser. The browser sends its
 * WebRTC offer and gets back an answer, then exchanges audio with OpenAI
 * directly. It never holds a credential, and the prompt, tools and model come
 * only from the server, so this cannot be used as a general Realtime proxy at
 * call setup.
 *
 * Talk is public and audio is costly, so it stays off until a dedicated key is
 * configured. Use a key from an OpenAI project with a spend limit: that limit is
 * the real ceiling, since these throttles only cover one function instance. */
export function createEducationTalkHandler({
  apiKey = () => process.env.ONCOGUIDE_TALK_OPENAI_API_KEY,
  fetchImpl = fetch,
  allowedOrigins,
  perClientLimit = 6,
  overallLimit = 60,
}: {
  apiKey?: () => string | undefined;
  fetchImpl?: typeof fetch;
  allowedOrigins?: string[];
  perClientLimit?: number;
  overallLimit?: number;
} = {}) {
  const calls = new Map<string, { count: number; until: number }>();
  const spend = (key: string, limit: number, now: number) => {
    const row = calls.get(key);
    const current = row && row.until > now ? row : { count: 0, until: now + WINDOW_MS };
    if (current.count >= limit) return false;
    current.count++;
    calls.set(key, current);
    return true;
  };
  return async function handleEducationTalk(request: Request) {
    const origin = request.headers.get("origin");
    const origins = allowedOrigins ?? ["https://oncoguide.cc", "https://www.oncoguide.cc", ...(process.env.ONCOGUIDE_CHAT_ORIGINS || "").split(",").filter(Boolean)];
    // Browsers always send Origin on these POSTs. Unlike chat, a request
    // without one is refused, because each accepted call costs real money.
    const permitted = !!origin && (origins.includes(origin) || origin === new URL(request.url).origin);
    const headers = new Headers({ "Cache-Control": "no-store", Vary: "Origin" });
    if (permitted) {
      headers.set("Access-Control-Allow-Origin", origin);
      headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
      headers.set("Access-Control-Allow-Headers", "Content-Type");
    }
    const fail = (error: string, status: number) => Response.json({ error }, { status, headers });
    if (!permitted) return fail("Origin is not allowed", 403);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (request.method !== "POST") { headers.set("Allow", "POST, OPTIONS"); return fail("Method not allowed", 405); }
    if (!request.headers.get("content-type")?.includes("application/sdp")) return fail("Expected an SDP offer", 415);

    const key = apiKey();
    if (!key) return fail("Talk isn’t available right now", 503);

    const declared = Number(request.headers.get("content-length") ?? 0);
    if (declared > MAX_SDP_BYTES) return fail("The call offer is too large", 413);
    const offer = await request.text();
    if (offer.length > MAX_SDP_BYTES || !offer.startsWith("v=0")) return fail("Expected an SDP offer", 400);

    const now = Date.now();
    for (const [name, row] of calls) if (row.until <= now) calls.delete(name);
    const client = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    // Per client first, so one client's refused retries can't use up everyone's share.
    if (calls.size >= 10_000 || !spend(`client:${client}`, perClientLimit, now) || !spend("overall", overallLimit, now)) {
      headers.set("Retry-After", "600");
      return fail("Talk is busy. Please try again in a few minutes", 429);
    }

    const form = new FormData();
    form.set("sdp", offer);
    form.set("session", JSON.stringify(talkSessionConfig()));
    let upstream: Response;
    try {
      upstream = await fetchImpl(REALTIME_CALLS_URL, {
        method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form,
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]),
      });
    } catch (error) {
      console.error("[education talk] call setup failed:", error instanceof Error ? error.name : "unknown");
      return fail("Talk couldn’t connect. Please try again", 502);
    }
    if (!upstream.ok) {
      // Log only the status and provider error code. Never the offer or key.
      const detail = await upstream.json().then((body: { error?: { code?: string; type?: string } }) => body.error?.code ?? body.error?.type).catch(() => undefined);
      console.error("[education talk] OpenAI refused the call:", upstream.status, detail ?? "");
      return upstream.status === 429 ? fail("Talk is busy. Please try again in a few minutes", 429) : fail("Talk couldn’t connect. Please try again", 502);
    }
    headers.set("Content-Type", "application/sdp");
    return new Response(await upstream.text(), { status: 200, headers });
  };
}

export const handleEducationTalk = createEducationTalkHandler();
