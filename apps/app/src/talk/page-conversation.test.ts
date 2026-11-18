import { expect, test } from "bun:test";
import type { TalkEvent } from "@oncobase/education/talk-transport";
import { PAGE_TALK_MAX_CHARS, pageNote } from "./contract";
import { PageConversation, type PageTalkStatus } from "./page-conversation";

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
function harness({ pages = { "wiki/plan": "# Plan\n\n## Surgery\nLumpectomy in May." } as Record<string, string | null>, found = "Surgery" as string | null } = {}) {
  const sent: TalkEvent[] = [];
  const statuses: PageTalkStatus[] = [];
  const pointed: string[] = [];
  const loads: string[] = [];
  const conversation = new PageConversation({
    send: event => sent.push(event),
    loadPage: async slug => { loads.push(slug); return pages[slug] ?? null; },
    pointAt: heading => { pointed.push(heading); return found; },
    onStatus: status => statuses.push(status),
  }, { slug: "wiki/plan", title: "Plan" });
  const notes = () => sent.filter(event => event.type === "conversation.item.create" && (event.item as { type: string }).type === "message")
    .map(event => ((event.item as { content: Array<{ text: string }> }).content[0]!.text));
  return { conversation, sent, statuses, pointed, loads, notes };
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
  expect(pointed).toEqual(["Surgery"]);
  const outputs = sent.filter(event => (event.item as { type?: string } | undefined)?.type === "function_call_output");
  expect(outputs).toHaveLength(1);
  expect(JSON.parse((outputs[0]!.item as { output: string }).output)).toMatchObject({ status: "scrolled", heading: "Surgery" });
  expect(sent.at(-1)).toEqual({ type: "response.create" });
});

test("a heading that isn't on the page is reported, not invented", () => {
  const { conversation, sent } = harness({ found: null });
  conversation.handle({ type: "response.done", response: { status: "completed", output: [{ type: "function_call", call_id: "c1", name: "point_to_section", arguments: '{"heading":"Nope"}' }] } });
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
