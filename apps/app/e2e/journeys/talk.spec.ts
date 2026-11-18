import { expect, test, type Page } from "@playwright/test";
import { documentArticle, gotoWiki, installWikiApiMocks, waitForPageTitle } from "../fixtures";

type Sent = { type: string; response?: { tool_choice?: string }; item?: { type: string; output?: string; content?: Array<{ text: string }> } };
type Fake = { sent: Sent[]; closed: boolean; emit: (event: unknown) => void };
declare global { interface Window { __talk: Fake } }

/** Stands in for the browser's WebRTC call to OpenAI. Everything above it runs
 * for real: the launcher, the panel, the page conversation and its page notes. */
function installFakeRealtime() {
  let channel: { readyState: string; onopen?: () => void; onmessage?: (event: { data: string }) => void } | undefined;
  const fake: Fake = { sent: [], closed: false, emit: event => channel!.onmessage?.({ data: JSON.stringify(event) }) };
  window.__talk = fake;
  navigator.mediaDevices.getUserMedia = async () => new AudioContext().createMediaStreamDestination().stream;
  window.RTCPeerConnection = class {
    connectionState = "new";
    constructor() { fake.closed = false; }
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

const PLAN = `# Treatment Plan

The plan starts with chemotherapy.

## Surgery

A lumpectomy follows chemotherapy.

[Reading a tumor](/wiki/education/reading-a-tumor/index)
`;

async function setUp(page: Page) {
  await page.addInitScript(installFakeRealtime);
  await installWikiApiMocks(page, {
    pageOverrides: {
      "wiki/logistics/insurance": { title: "Treatment Plan", content: PLAN },
      "wiki/education/reading-a-tumor/index": { title: "Reading a Tumor", tags: ["education"], content: "# Reading a Tumor\n\nReview morphology and biomarkers together.\n" },
    },
  });
  const offers: string[] = [];
  await page.route("**/api/wiki/talk", async route => {
    offers.push(route.request().postData() ?? "");
    await route.fulfill({ status: 200, contentType: "application/sdp", body: "v=0\r\nfake-answer\r\n" });
  });
  return offers;
}

const notes = (page: Page) => page.evaluate(() => window.__talk.sent
  .filter(event => event.type === "conversation.item.create" && event.item?.type === "message")
  .map(event => event.item!.content![0]!.text));

async function startCall(page: Page, open: () => Promise<void>) {
  await open();
  const consent = page.getByRole("dialog", { name: "Talk with the page" });
  await expect(consent).toContainText("go to OpenAI");
  await consent.getByRole("button", { name: "Start talking" }).click();
  await expect(page.getByTestId("talk-call")).toBeVisible();
  await page.evaluate(() => window.__talk.emit({ type: "session.created" }));
  await expect.poll(() => notes(page)).toHaveLength(1);
}

test.describe("talk with the page (mocked backend, fake Realtime)", () => {
  test("desktop: the corner launcher starts a call about this page, shows only the avatar, follows navigation and hangs up", async ({ page }) => {
    const offers = await setUp(page);
    await gotoWiki(page, "/wiki/logistics/insurance");
    const launcher = page.getByTestId("talk-launcher");
    await expect(launcher).toBeVisible();
    const box = (await launcher.boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(box.x + box.width).toBeGreaterThan(viewport.width - 64);
    expect(box.y + box.height).toBeGreaterThan(viewport.height - 64);

    await startCall(page, () => launcher.click());
    expect(offers[0]).toContain("fake-offer");
    expect((await notes(page))[0]).toContain('is on the page "Treatment Plan"');
    expect((await notes(page))[0]).toContain("A lumpectomy follows chemotherapy.");
    const greeting = await page.evaluate(() => window.__talk.sent.find(event => event.type === "response.create"));
    expect(greeting?.response?.tool_choice).toBe("none");

    // While the call runs: one floating avatar, no launcher, no transcript or chat.
    await expect(launcher).toHaveCount(0);
    await expect(page.getByTestId("talk-call").locator(".wiki-vite-talk-avatar")).toBeVisible();
    await expect(page.getByTestId("talk-call")).not.toContainText("lumpectomy");
    await expect(page.getByTestId("chat-interface")).toHaveCount(0);

    // The voice points at a section: the page scrolls there and the call gets an answer.
    await page.evaluate(() => window.__talk.emit({ type: "response.done", response: { status: "completed", output: [{ type: "function_call", call_id: "c1", name: "point_to_section", arguments: JSON.stringify({ heading: "Surgery" }) }] } }));
    await expect(documentArticle(page).locator('[data-talk-pointed="true"]')).toContainText("Surgery");
    const output = await page.evaluate(() => window.__talk.sent.find(event => event.item?.type === "function_call_output")?.item?.output);
    expect(JSON.parse(output!)).toMatchObject({ status: "scrolled", heading: "Surgery" });

    // Mute shows on the avatar.
    await page.getByRole("button", { name: "Mute microphone" }).click();
    await expect(page.getByRole("button", { name: "Unmute microphone" })).toHaveAttribute("aria-pressed", "true");

    // Client navigation keeps the call and tells the voice about the new page.
    await documentArticle(page).getByRole("link", { name: "Reading a tumor" }).click();
    await waitForPageTitle(page, "Reading a Tumor");
    await expect.poll(async () => (await notes(page)).at(-1) ?? "").toContain("Review morphology and biomarkers together.");
    expect((await notes(page)).at(-1)).toContain("has moved to the page");
    expect(await page.evaluate(() => window.__talk.closed)).toBe(false);

    await page.getByRole("button", { name: "End talk" }).click();
    await expect(page.getByTestId("talk-call")).toHaveCount(0);
    expect(await page.evaluate(() => window.__talk.closed)).toBe(true);
    await expect(launcher).toBeFocused();
  });

  test("the voice opens a page the reader names (Jev picks it) and goes back", async ({ page }) => {
    await setUp(page);
    const asked: Array<{ query: string; candidates: Array<{ slug: string }> }> = [];
    await page.route("**/api/wiki/palette-recommend**", async route => {
      asked.push(route.request().postDataJSON());
      await route.fulfill({ json: { model: "typesafe-ai/jev", results: [{ slug: "wiki/education/reading-a-tumor/index", score: 2.6 }] } });
    });
    await gotoWiki(page, "/wiki/logistics/insurance");
    await startCall(page, () => page.getByTestId("talk-launcher").click());
    const outputs = () => page.evaluate(() => window.__talk.sent.filter(event => event.item?.type === "function_call_output").map(event => JSON.parse(event.item!.output!)));

    await page.evaluate(() => window.__talk.emit({ type: "response.done", response: { status: "completed", output: [{ type: "function_call", call_id: "open1", name: "open_page", arguments: JSON.stringify({ request: "the tumor reading lesson" }) }] } }));
    await waitForPageTitle(page, "Reading a Tumor");
    await expect(page).toHaveURL(/\/wiki\/education\/reading-a-tumor/);
    await expect.poll(outputs).toEqual([expect.objectContaining({ status: "opened", title: "Reading a Tumor" })]);
    // No page is named exactly that, so Jev chose from the reader's own candidates.
    expect(asked[0]!.query).toBe("the tumor reading lesson");
    expect(asked[0]!.candidates.map(candidate => candidate.slug)).toContain("wiki/education/reading-a-tumor/index");
    // The new page's text went in once, before the answer, and the call stayed up.
    expect((await notes(page)).filter(note => note.includes("Review morphology and biomarkers together."))).toHaveLength(1);
    await expect(page.getByTestId("talk-call")).toBeVisible();

    await page.evaluate(() => window.__talk.emit({ type: "response.done", response: { status: "completed", output: [{ type: "function_call", call_id: "back1", name: "go_back", arguments: "{}" }] } }));
    await waitForPageTitle(page, "Treatment Plan");
    await expect.poll(async () => (await outputs()).at(-1)).toMatchObject({ status: "went_back" });
    expect((await notes(page)).at(-1)).toContain('has moved to the page "Treatment Plan"');
  });

  test("a refused call explains itself and offers no retry when Talk is off", async ({ page }) => {
    await setUp(page);
    await page.route("**/api/wiki/talk", route => route.fulfill({ status: 503, json: { error: "Talk isn’t available right now" } }));
    await gotoWiki(page, "/wiki/logistics/insurance");
    await page.getByTestId("talk-launcher").click();
    await page.getByRole("button", { name: "Start talking" }).click();
    const alert = page.getByRole("alert");
    await expect(alert).toContainText("Talk isn’t available right now.");
    await expect(alert.getByRole("button", { name: "Talk again" })).toHaveCount(0);
    await alert.getByRole("button", { name: "Close" }).click();
    await expect(page.getByTestId("talk-launcher")).toBeVisible();
  });

  test.describe("mobile", () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test("Talk joins Ask wiki in one floating group, and the call replaces the group with the avatar", async ({ page }) => {
      await setUp(page);
      await gotoWiki(page, "/wiki/logistics/insurance");
      const group = page.getByTestId("mobile-fab-group");
      await expect(group).toBeVisible();
      await expect(group.getByRole("button", { name: "Talk with the page" })).toBeVisible();
      await expect(group.getByRole("link", { name: "Ask wiki" })).toBeVisible();
      await expect(page.getByTestId("talk-launcher")).toBeHidden();

      await startCall(page, () => group.getByRole("button", { name: "Talk with the page" }).tap());
      await expect(group).toHaveCount(0);
      await expect(page.getByTestId("talk-call")).toBeVisible();

      await page.getByRole("button", { name: "End talk" }).tap();
      await expect(page.getByTestId("mobile-fab-group")).toBeVisible();
    });

    test("screens without page text keep Ask wiki but drop Talk", async ({ page }) => {
      await setUp(page);
      await page.goto("/search", { waitUntil: "domcontentloaded" });
      const group = page.getByTestId("mobile-fab-group");
      await expect(group.getByRole("link", { name: "Ask wiki" })).toBeVisible();
      await expect(group.getByRole("button", { name: "Talk with the page" })).toHaveCount(0);
    });
  });
});
