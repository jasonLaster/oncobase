import { expect, test, type Page } from "@playwright/test";

const start = "/education/guides/start-here/01-read-the-labels/";
const adc = "/education/concepts/therapeutics/antibody-based/antibody-drug-conjugate/";
const adcSection = `${adc}#how-it-works`;

type Fake = {
  sent: Array<{ type: string; item?: { type: string; role?: string; call_id?: string; output?: string; content?: Array<{ text: string }> } }>;
  peers: number; closed: boolean; micCalls: number; micState: () => { enabled: boolean; readyState: string } | null;
  emit: (event: unknown) => void; drop: () => void;
};
declare global { interface Window { __talk: Fake; __micFailure?: string; __sameDocument?: boolean } }

/** Stands in for the browser's call to OpenAI. Everything above it runs for
 * real: the panel, conversation, tools, library search and client routing. */
function installFakeRealtime() {
  let channel: { readyState: string; onopen?: () => void; onmessage?: (event: { data: string }) => void; onclose?: () => void } | undefined;
  let peer: { connectionState: string; onconnectionstatechange?: () => void } | undefined;
  let track: MediaStreamTrack | undefined;
  const fake: Fake = {
    sent: [], peers: 0, closed: false, micCalls: 0,
    micState: () => track ? { enabled: track.enabled, readyState: track.readyState } : null,
    emit: event => channel!.onmessage?.({ data: JSON.stringify(event) }),
    drop: () => { peer!.connectionState = "failed"; peer!.onconnectionstatechange?.(); },
  };
  window.__talk = fake;
  navigator.mediaDevices.getUserMedia = async () => {
    fake.micCalls++;
    if (window.__micFailure) throw new DOMException("Refused", window.__micFailure);
    const stream = new AudioContext().createMediaStreamDestination().stream;
    track = stream.getAudioTracks()[0];
    return stream;
  };
  window.RTCPeerConnection = class {
    connectionState = "new";
    onconnectionstatechange?: () => void;
    constructor() { fake.peers++; peer = this; fake.closed = false; }
    addTrack() {}
    createDataChannel() {
      const created = { readyState: "connecting", send: (data: string) => fake.sent.push(JSON.parse(data)), close() { created.readyState = "closed"; } };
      channel = created;
      return created;
    }
    async createOffer() { return { type: "offer", sdp: "v=0\r\nfake-offer\r\n" }; }
    async setLocalDescription() {}
    async setRemoteDescription() { setTimeout(() => { channel!.readyState = "open"; channel!.onopen?.(); }); }
    close() { fake.closed = true; }
  } as never;
}

async function open(page: Page, path = start, { status = 200 } = {}) {
  await page.addInitScript(installFakeRealtime);
  await page.route("**/api/education/talk", route => {
    expect(route.request().headers()["content-type"]).toBe("application/sdp");
    expect(route.request().postData()).toContain("v=0");
    return route.fulfill(status === 200 ? { status, contentType: "application/sdp", body: "v=0\r\nfake-answer\r\n" } : { status, json: { error: "nope" } });
  });
  await page.goto(path);
  await page.evaluate(() => { window.__sameDocument = true; });
}
async function startCall(page: Page) {
  await page.getByRole("button", { name: "Talk with OncoGuide" }).click();
  await page.getByRole("button", { name: "Start talking" }).click();
  await expect(page.getByRole("group", { name: "Talk with OncoGuide" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__talk.peers)).toBe(1);
  await expect(page.getByText("Connecting…")).toBeVisible();
  await page.evaluate(() => window.__talk.emit({ type: "session.created" }));
  await expect(page.getByRole("status").filter({ hasText: "Listening" })).toBeVisible();
}
const emitTool = (page: Page, name: string, args: unknown, callId = name) => page.evaluate(({ name, args, callId }) =>
  window.__talk.emit({ type: "response.done", response: { status: "completed", output: [{ type: "function_call", call_id: callId, name, arguments: JSON.stringify(args) }] } }), { name, args, callId });
const notes = (page: Page) => page.evaluate(() => window.__talk.sent.filter(event => event.item?.role === "system").map(event => event.item!.content![0]!.text));
const toolOutput = async (page: Page, callId: string) => JSON.parse(await page.evaluate(id => window.__talk.sent.find(event => event.item?.call_id === id)?.item?.output ?? "null", callId));
const stayedInPage = (page: Page) => page.evaluate(() => window.__sameDocument === true && window.__talk.peers === 1 && !window.__talk.closed);

test("the call code and library load only after a reader opts in", async ({ page }) => {
  const loaded: string[] = [];
  page.on("request", request => loaded.push(new URL(request.url()).pathname));
  await open(page);
  await expect(page.getByRole("button", { name: "Talk with OncoGuide" })).toBeVisible();
  expect(loaded).not.toContain("/chat-index.json");

  await page.getByRole("button", { name: "Talk with OncoGuide" }).click();
  const dialog = page.getByRole("dialog", { name: "Talk with OncoGuide" });
  await expect(dialog).toContainText("microphone audio goes to OpenAI");
  await expect(dialog).toContainText("AI voice");
  await expect(dialog).toContainText("not medical advice");
  expect(await page.evaluate(() => window.__talk.micCalls)).toBe(0);
  expect(loaded).not.toContain("/chat-index.json");

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Talk with OncoGuide" })).toBeFocused();
  expect(await page.evaluate(() => window.__talk.micCalls)).toBe(0);

  await startCall(page);
  expect(loaded).toContain("/chat-index.json");
  // Once agreed, the next call in this browser starts directly.
  await page.getByRole("button", { name: "End talk" }).click();
  await page.getByRole("button", { name: "Talk with OncoGuide" }).click();
  await expect(page.getByRole("group", { name: "Talk with OncoGuide" })).toBeVisible();
  await expect(page.getByRole("dialog")).toBeHidden();
});

test("the model learns the reader's page, then greets them", async ({ page }) => {
  await open(page);
  await startCall(page);
  await expect.poll(() => notes(page)).toContainEqual(expect.stringContaining("Read each label as an answer to a question"));
  const types = await page.evaluate(() => window.__talk.sent.map(event => event.type));
  expect(types).toEqual(["conversation.item.create", "response.create"]);
});

test("reading a section raises a prompt, and Yes opens it without ending the call", async ({ page }) => {
  await open(page);
  await startCall(page);
  await emitTool(page, "search_education", { query: "antibody drug conjugates" }, "search");
  await expect.poll(() => toolOutput(page, "search")).toMatchObject({ results: expect.arrayContaining([expect.objectContaining({ pageTitle: "ADC (antibody-drug conjugate)" })]) });

  await emitTool(page, "read_section", { section_id: adcSection }, "read");
  const prompt = page.getByRole("status", { name: "Suggested page" });
  await expect(prompt).toContainText("ADC (antibody-drug conjugate)");
  await expect(prompt).toContainText("How it works");
  await expect.poll(async () => (await toolOutput(page, "read"))?.page_prompt).toContain("ADC (antibody-drug conjugate)");
  await expect(page).toHaveURL(new RegExp(`${start}$`));

  await page.getByRole("button", { name: "Yes, open it" }).click();
  await expect(page).toHaveURL(new RegExp(`${adcSection}$`));
  await expect(page.getByTestId("education-article").getByRole("heading", { level: 1 })).toHaveText("ADC (antibody-drug conjugate)");
  await expect(page.getByRole("heading", { name: "How it works" })).toBeInViewport();
  await expect(prompt).toBeHidden();
  expect(await stayedInPage(page)).toBe(true);
  await expect.poll(() => notes(page)).toContainEqual(expect.stringContaining('tapped Yes and is now viewing the "How it works" section'));
  await expect(page.getByRole("group", { name: "Talk with OncoGuide" })).toBeVisible();
});

test("a spoken yes opens the page, and Not now keeps the reader in place", async ({ page }) => {
  await open(page);
  await startCall(page);
  await emitTool(page, "suggest_page", { section_id: adcSection, reason: "It shows how ADCs deliver drugs" }, "s1");
  await expect(page.getByRole("status", { name: "Suggested page" })).toContainText("It shows how ADCs deliver drugs");
  await page.getByRole("button", { name: "Not now" }).click();
  await expect(page.getByRole("status", { name: "Suggested page" })).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`${start}$`));
  await expect.poll(() => notes(page)).toContainEqual(expect.stringContaining("tapped Not now"));

  await emitTool(page, "suggest_page", { section_id: adcSection, reason: "x" }, "s2");
  await expect.poll(() => toolOutput(page, "s2")).toMatchObject({ status: "declined_earlier" });
  await expect(page.getByRole("status", { name: "Suggested page" })).toBeHidden();

  await emitTool(page, "open_page", { section_id: adcSection }, "o1");
  await expect(page).toHaveURL(new RegExp(`${adcSection}$`));
  await expect.poll(() => toolOutput(page, "o1")).toMatchObject({ status: "opened" });
  expect(await stayedInPage(page)).toBe(true);
});

test("the model cannot send a reader somewhere that is not a lesson", async ({ page }) => {
  await open(page);
  await startCall(page);
  await emitTool(page, "open_page", { section_id: "https://attacker.test/" }, "bad");
  await expect.poll(() => toolOutput(page, "bad")).toHaveProperty("error");
  await expect(page).toHaveURL(new RegExp(`${start}$`));
});

test("lesson links, search and the sidebar keep the call alive and update the model", async ({ page }) => {
  await open(page);
  await startCall(page);
  const before = (await notes(page)).length;

  await page.getByTestId("education-article").locator("a", { hasText: "Start here" }).first().click();
  await expect(page).toHaveURL(/\/education\/guides\/start-here\/$|\/education\/guides\/start-here\/index\/$/);
  await expect.poll(async () => (await notes(page)).length).toBeGreaterThan(before);
  expect(await stayedInPage(page)).toBe(true);

  const search = page.getByRole("searchbox", { name: "Search education" });
  await search.fill("autophagy");
  await search.press("Enter");
  await expect(page).toHaveURL(/\/education\/search\/\?q=autophagy/);
  await expect.poll(() => page.locator(".edu-result").count()).toBeGreaterThan(0);
  expect(await stayedInPage(page)).toBe(true);
  await expect.poll(async () => (await notes(page)).at(-1)).toContain("not on a specific lesson");

  await page.locator(".edu-result").first().click();
  await expect(page.getByTestId("education-article")).toBeVisible();
  expect(await stayedInPage(page)).toBe(true);
  await page.getByRole("link", { name: "All topics", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "The education library" })).toBeVisible();
  expect(await stayedInPage(page)).toBe(true);
});

test("status and captions follow the conversation", async ({ page }) => {
  await open(page);
  await startCall(page);
  const emit = (event: unknown) => page.evaluate(next => window.__talk.emit(next), event);
  const caption = page.getByTestId("talk-caption");
  await emit({ type: "input_audio_buffer.speech_started" });
  await emit({ type: "input_audio_buffer.speech_stopped" });
  await expect(page.getByRole("status").filter({ hasText: "Thinking…" })).toBeVisible();
  await emit({ type: "conversation.item.input_audio_transcription.completed", transcript: "What is an ADC?" });
  await expect(caption).toHaveText("What is an ADC?");
  await emit({ type: "response.created" });
  await emit({ type: "output_audio_buffer.started" });
  await emit({ type: "response.output_audio_transcript.delta", delta: "A targeted " });
  await emit({ type: "response.output_audio_transcript.delta", delta: "medicine." });
  await expect(page.getByRole("status").filter({ hasText: "Speaking" })).toBeVisible();
  await expect(caption).toHaveText("A targeted medicine.");
  await emit({ type: "output_audio_buffer.stopped" });
  await expect(page.getByRole("status").filter({ hasText: "Listening" })).toBeVisible();
  await emit({ type: "input_audio_buffer.speech_started" });
  await expect(caption).toBeHidden();
});

test("mute silences the mic, and ending the call releases it", async ({ page }) => {
  await open(page);
  await startCall(page);
  await page.getByRole("button", { name: "Mute microphone" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Muted" })).toBeVisible();
  expect(await page.evaluate(() => window.__talk.micState())).toMatchObject({ enabled: false, readyState: "live" });
  await page.getByRole("button", { name: "Unmute microphone" }).click();
  expect(await page.evaluate(() => window.__talk.micState())).toMatchObject({ enabled: true });

  await page.getByRole("button", { name: "End talk" }).click();
  await expect(page.getByRole("button", { name: "Talk with OncoGuide" })).toBeVisible();
  expect(await page.evaluate(() => window.__talk.micState())).toMatchObject({ readyState: "ended" });
  expect(await page.evaluate(() => window.__talk.closed)).toBe(true);

  // With no call, header search returns to its normal full page load.
  const search = page.getByRole("searchbox", { name: "Search education" });
  await search.fill("autophagy");
  await search.press("Enter");
  await expect(page).toHaveURL(/\/education\/search\/\?q=autophagy/);
  await expect.poll(() => page.evaluate(() => window.__sameDocument)).toBeUndefined();
});

test("failures explain themselves, and only recoverable ones offer a retry", async ({ page }) => {
  await open(page);
  await page.evaluate(() => { window.__micFailure = "NotAllowedError"; });
  await page.getByRole("button", { name: "Talk with OncoGuide" }).click();
  await page.getByRole("button", { name: "Start talking" }).click();
  await expect(page.locator(".edu-talk-card[role=alert]")).toContainText("needs your microphone");
  expect(await page.evaluate(() => window.__talk.peers)).toBe(0);
  await page.evaluate(() => { window.__micFailure = undefined; });
  await page.getByRole("button", { name: "Talk again" }).click();
  await expect(page.getByRole("group", { name: "Talk with OncoGuide" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__talk.peers)).toBe(1);

  await page.evaluate(() => window.__talk.emit({ type: "session.created" }));
  await page.evaluate(() => window.__talk.drop());
  await expect(page.locator(".edu-talk-card[role=alert]")).toContainText("The call dropped");
  expect(await page.evaluate(() => window.__talk.micState())).toMatchObject({ readyState: "ended" });
  await expect(page.getByRole("button", { name: "Talk again" })).toBeVisible();
});

for (const [status, message, retry] of [[429, "busy", true], [503, "isn’t available", false]] as const) {
  test(`a ${status} from the server reads clearly and closes the mic`, async ({ page }) => {
    await open(page, start, { status });
    await page.getByRole("button", { name: "Talk with OncoGuide" }).click();
    await page.getByRole("button", { name: "Start talking" }).click();
    await expect(page.locator(".edu-talk-card[role=alert]")).toContainText(message);
    await expect(page.getByRole("button", { name: "Talk again" })).toHaveCount(retry ? 1 : 0);
    expect(await page.evaluate(() => window.__talk.micState())).toMatchObject({ readyState: "ended" });
    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.getByRole("button", { name: "Talk with OncoGuide" })).toBeVisible();
  });
}

test("Talk fits a phone and stays clear of chat's composer", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await startCall(page);
  await emitTool(page, "read_section", { section_id: adcSection }, "read");
  await expect(page.getByRole("button", { name: "Yes, open it" })).toBeVisible();
  for (const name of ["Yes, open it", "Not now", "Mute microphone", "End talk"]) await expect(page.getByRole("button", { name })).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/education/chat/");
    const launcher = await page.getByRole("button", { name: "Talk with OncoGuide" }).boundingBox();
    const composer = await page.locator(".session-chat-input-row").boundingBox();
    expect(launcher!.y + launcher!.height).toBeLessThanOrEqual(composer!.y);
  }
});
