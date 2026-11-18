import { expect, test } from "bun:test";
import type { TalkEvent } from "@oncobase/education/talk-transport";
import { PAGE_TALK_MAX_CHARS, pageNote } from "./contract";
import { PageConversation, type FoundPage, type PageTalkStatus } from "./page-conversation";

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
function harness({ pages = { "wiki/plan": "# Plan\n\n## Surgery\nLumpectomy in May." } as Record<string, string | null>, found = "Surgery" as string | null, find = (async () => ({ page: null })) as (request: string) => Promise<FoundPage>, canGoBack = false } = {}) {
  const sent: TalkEvent[] = [];
  const statuses: PageTalkStatus[] = [];
  const pointed: string[] = [];
  const loads: string[] = [];
  const navigated: string[] = [];
  const requests: string[] = [];
  let backs = 0;
  const conversation = new PageConversation({
    send: event => sent.push(event),
    loadPage: async slug => { loads.push(slug); return pages[slug] ?? null; },
    pointAt: heading => { pointed.push(heading); return found; },
    onStatus: status => statuses.push(status),
    findPage: request => { requests.push(request); return find(request); },
    navigate: slug => navigated.push(slug),
    goBack: () => { backs++; return canGoBack; },
  }, { slug: "wiki/plan", title: "Plan" });
  const notes = () => sent.filter(event => event.type === "conversation.item.create" && (event.item as { type: string }).type === "message")
    .map(event => ((event.item as { content: Array<{ text: string }> }).content[0]!.text));
  const outputs = () => sent.filter(event => (event.item as { type?: string } | undefined)?.type === "function_call_output")
    .map(event => JSON.parse((event.item as { output: string }).output) as Record<string, unknown>);
  const call = (name: string, args: object, id = name) => conversation.handle({ type: "response.done", response: { status: "completed", output: [{ type: "function_call", call_id: id, name, arguments: JSON.stringify(args) }] } });
  return { conversation, sent, statuses, pointed, loads, notes, navigated, requests, outputs, call, backs: () => backs };
}

test("sends the page text, then asks for a greeting without tools", async () => {
  const { conversation, sent, notes, statuses } = harness();
  conversation.handle({ type: "session.created" });
  await flush();
  expect(notes()).toHaveLength(1);
  expect(notes()[0]).toContain('The reader is on the page "Plan" (wiki/plan)');
  expect(notes()[0]).toContain("Lumpectomy in May.");
  expect(sent.at(-1)).toMatchObject({ type: "response.create", response: { tool_choice: "none" } });
  expect(statuses).toEqual(["listening"]);
});

test("notes a page change only after the call starts, and only once per page", async () => {
  const { conversation, notes, loads } = harness({ pages: { "wiki/plan": "plan", "wiki/scans": "scan text" } });
  await conversation.notePage({ slug: "wiki/scans", title: "Scans" });
  expect(loads).toEqual([]);
  conversation.handle({ type: "session.created" });
  await flush();
  expect(notes()[0]).toContain("scan text");
  await conversation.notePage({ slug: "wiki/scans", title: "Scans" });
  await conversation.notePage({ slug: "wiki/plan", title: "Plan" });
  expect(notes()).toHaveLength(2);
  expect(notes()[1]).toContain('has moved to the page "Plan"');
  expect(notes()[1]).toContain("do not greet them again");
  await conversation.notePage(null);
  expect(notes().at(-1)).toContain("left the wiki page");
});

test("an unreadable page says so instead of sending nothing", async () => {
  const { conversation, notes } = harness({ pages: {} });
  conversation.handle({ type: "session.created" });
  await flush();
  expect(notes()[0]).toContain("could not be loaded");
});

test("long pages are cut and marked", () => {
  const note = pageNote({ slug: "a", title: "A", markdown: "x".repeat(PAGE_TALK_MAX_CHARS + 500) }, true);
  expect(note).toContain("the rest was not included");
  expect(note.length).toBeLessThan(PAGE_TALK_MAX_CHARS + 400);
});

test("point_to_section scrolls the page, answers the call once and resumes speaking", async () => {
  const { conversation, sent, pointed } = harness();
  const done = { type: "response.done", response: { status: "completed", output: [{ type: "function_call", call_id: "c1", name: "point_to_section", arguments: '{"heading":"Surgery"}' }] } };
  conversation.handle(done);
  conversation.handle(done);
  await flush();
  expect(pointed).toEqual(["Surgery"]);
  const outputs = sent.filter(event => (event.item as { type?: string } | undefined)?.type === "function_call_output");
  expect(outputs).toHaveLength(1);
  expect(JSON.parse((outputs[0]!.item as { output: string }).output)).toMatchObject({ status: "scrolled", heading: "Surgery" });
  expect(sent.at(-1)).toEqual({ type: "response.create" });
});

test("a heading that isn't on the page is reported, not invented", async () => {
  const { conversation, sent } = harness({ found: null });
  conversation.handle({ type: "response.done", response: { status: "completed", output: [{ type: "function_call", call_id: "c1", name: "point_to_section", arguments: '{"heading":"Nope"}' }] } });
  await flush();
  const output = sent.find(event => (event.item as { type?: string } | undefined)?.type === "function_call_output")!;
  expect(JSON.parse((output.item as { output: string }).output).status).toBe("not_found");
});

test("tracks speaking and listening for the avatar", () => {
  const { conversation, statuses } = harness();
  conversation.handle({ type: "input_audio_buffer.speech_started" });
  conversation.handle({ type: "input_audio_buffer.speech_stopped" });
  conversation.handle({ type: "response.created" });
  conversation.handle({ type: "output_audio_buffer.started" });
  conversation.handle({ type: "output_audio_buffer.stopped" });
  expect(statuses).toEqual(["hearing", "thinking", "speaking", "listening"]);
});

test("a closed call sends nothing more", async () => {
  const { conversation, sent } = harness();
  conversation.close();
  conversation.handle({ type: "session.created" });
  await flush();
  expect(sent).toEqual([]);
});

test("open_page opens the page Jev picked and notes its text before answering", async () => {
  const { conversation, sent, notes, navigated, requests, outputs, call } = harness({
    pages: { "wiki/plan": "plan", "wiki/treatment/adjuvant-planning": "# Adjuvant Planning\n\nCapecitabine after surgery." },
    find: async () => ({ page: { slug: "wiki/treatment/adjuvant-planning", title: "adjuvant-planning" }, alternatives: ["Adjuvant Trials"] }),
  });
  conversation.handle({ type: "session.created" });
  await flush();
  call("open_page", { request: "adjuvant planning" });
  await flush(); await flush();
  expect(requests).toEqual(["adjuvant planning"]);
  expect(navigated).toEqual(["wiki/treatment/adjuvant-planning"]);
  expect(notes().at(-1)).toContain('has moved to the page "Adjuvant Planning"');
  expect(notes().at(-1)).toContain("Capecitabine after surgery.");
  expect(outputs()[0]).toMatchObject({ status: "opened", title: "Adjuvant Planning", other_close_matches: ["Adjuvant Trials"] });
  // The page note goes in before the tool's answer, and the follow-up comes last.
  const noteAt = sent.findIndex(event => (event.item as { type?: string } | undefined)?.type === "message" && JSON.stringify(event).includes("Capecitabine"));
  const outputAt = sent.findIndex(event => (event.item as { type?: string } | undefined)?.type === "function_call_output");
  expect(noteAt).toBeLessThan(outputAt);
  expect(sent.at(-1)).toEqual({ type: "response.create" });
  // The route change that follows doesn't note the same page again.
  await conversation.notePage({ slug: "wiki/treatment/adjuvant-planning", title: "adjuvant-planning" });
  expect(notes()).toHaveLength(2);
});

test("open_page offers suggestions when nothing matched, and doesn't reopen the current page", async () => {
  let result: FoundPage = { page: null, suggestions: ["Pathology Report", "Pathology Overview"] };
  const { conversation, navigated, outputs, call } = harness({ find: async () => result });
  conversation.handle({ type: "session.created" });
  await flush();
  call("open_page", { request: "path" }, "a");
  await flush(); await flush();
  expect(outputs()[0]).toMatchObject({ status: "not_found", suggestions: ["Pathology Report", "Pathology Overview"] });
  result = { page: { slug: "wiki/plan", title: "Plan" } };
  call("open_page", { request: "the plan" }, "b");
  await flush(); await flush();
  expect(outputs()[1]).toMatchObject({ status: "already_open" });
  expect(navigated).toEqual([]);
});

test("go_back waits for the earlier page's text, and says when there is nowhere to go", async () => {
  const first = harness({ canGoBack: false });
  first.conversation.handle({ type: "session.created" });
  await flush();
  first.call("go_back", {});
  await flush();
  expect(first.outputs()[0]).toMatchObject({ status: "nowhere_to_go" });

  const { conversation, outputs, notes, call, backs } = harness({ canGoBack: true, pages: { "wiki/plan": "plan", "wiki/scans": "# Scans\n\nMRI in June." } });
  conversation.handle({ type: "session.created" });
  await flush();
  call("go_back", {});
  await flush();
  expect(backs()).toBe(1);
  expect(outputs()).toHaveLength(0);
  await conversation.notePage({ slug: "wiki/scans", title: "Scans" });
  await flush();
  expect(notes().at(-1)).toContain("MRI in June.");
  expect(outputs()[0]).toMatchObject({ status: "went_back", title: "Scans" });
});
