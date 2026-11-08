import { expect, test } from "bun:test";
import { buildEducationCorpus } from "@oncobase/education/chat-index";
import { TalkConversation, type TalkView } from "./talk-conversation";
import type { TalkEvent } from "./talk-transport";

const corpus = buildEducationCorpus([
  { slug: "wiki/education/adcs", title: "Antibody-drug conjugates", html: '<p>Overview text for this lesson.</p><h2 id="payload">The payload</h2><p>An antibody drug conjugate delivers a toxic payload.</p>' },
  { slug: "wiki/education/dna", title: "DNA repair", html: '<p>Cells repair damaged DNA.</p>' },
], "commit-a");
const payload = "/education/adcs/#payload";
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

function harness(path = "/education/dna/", loadCorpus: () => Promise<typeof corpus> = async () => corpus) {
  const sent: TalkEvent[] = [];
  const navigations: string[] = [];
  let view: TalkView | undefined;
  const conversation = new TalkConversation({ send: event => sent.push(event), navigate: href => navigations.push(href), corpus: loadCorpus, onChange: next => { view = next; } }, path);
  return {
    conversation, sent, navigations, view: () => view!,
    call: async (name: string, args: unknown, callId = name) => {
      conversation.handle({ type: "response.done", response: { status: "completed", output: [{ type: "function_call", call_id: callId, name, arguments: JSON.stringify(args) }] } });
      await settle();
    },
    output: (callId: string) => JSON.parse((sent.find(event => (event.item as { call_id?: string } | undefined)?.call_id === callId)!.item as { output: string }).output),
    notes: () => sent.filter(event => (event.item as { role?: string } | undefined)?.role === "system").map(event => ((event.item as { content: Array<{ text: string }> }).content[0]!.text)),
    replies: () => sent.filter(event => event.type === "response.create"),
  };
}

test("tells the model where the reader is, then greets", async () => {
  const talk = harness();
  talk.conversation.handle({ type: "session.created" });
  await settle();
  expect(talk.notes()[0]).toContain('"DNA repair"');
  expect(talk.notes()[0]).toContain("wiki/education/dna");
  expect(talk.replies()).toHaveLength(1);
  expect(talk.view().status).toBe("listening");
});

test("still greets if the library fails to load, and tools report that honestly", async () => {
  const talk = harness("/education/dna/", async () => { throw Error("offline"); });
  talk.conversation.handle({ type: "session.created" });
  await settle();
  expect(talk.replies()).toHaveLength(1);
  await talk.call("search_education", { query: "ADC" });
  expect(talk.output("search_education").error).toContain("could not load");
});

test("search results go back to the model and trigger a reply", async () => {
  const talk = harness();
  await talk.call("search_education", { query: "ADCs" });
  expect(talk.output("search_education").results[0].id).toBe(payload);
  expect(talk.replies()).toHaveLength(1);
});

test("a suggestion shows a prompt but does not navigate", async () => {
  const talk = harness();
  await talk.call("suggest_page", { section_id: payload, reason: "It explains how ADCs deliver drugs" });
  expect(talk.navigations).toEqual([]);
  expect(talk.view().suggestion).toMatchObject({ href: payload, heading: "The payload", pageTitle: "Antibody-drug conjugates", reason: "It explains how ADCs deliver drugs" });
  expect(talk.output("suggest_page").status).toBe("prompt_shown");
});

test("reading a section on another page raises its prompt once and tells the model", async () => {
  const talk = harness();
  await talk.call("read_section", { section_id: payload }, "r1");
  expect(talk.view().suggestion).toMatchObject({ href: payload, heading: "The payload", reason: "" });
  expect(talk.output("r1").heading).toBe("The payload");
  expect(talk.output("r1").page_prompt).toContain("Antibody-drug conjugates");
  expect(talk.navigations).toEqual([]);
  // Reading the page again does not re-raise it after the reader moves on.
  talk.conversation.dismissSuggestion();
  await talk.call("read_section", { section_id: "/education/adcs/" }, "r2");
  expect(talk.view().suggestion).toBeNull();
  expect(talk.output("r2").page_prompt).toBeUndefined();
});

test("reading the current page raises no prompt", async () => {
  const talk = harness("/education/adcs/");
  await talk.call("read_section", { section_id: payload }, "r1");
  expect(talk.view()?.suggestion ?? null).toBeNull();
  expect(talk.output("r1").page_prompt).toBeUndefined();
});

test("a page the reader declined cannot be offered again, by tapping or speech", async () => {
  const tapped = harness();
  await tapped.call("suggest_page", { section_id: payload, reason: "x" }, "s1");
  tapped.conversation.dismissSuggestion();
  await tapped.call("suggest_page", { section_id: "/education/adcs/", reason: "x" }, "s2");
  expect(tapped.output("s2").status).toBe("declined_earlier");
  expect(tapped.view().suggestion).toBeNull();

  const spoken = harness();
  await spoken.call("suggest_page", { section_id: payload, reason: "x" }, "s1");
  await spoken.call("dismiss_suggestion", {}, "d1");
  await spoken.call("read_section", { section_id: payload }, "r1");
  expect(spoken.view().suggestion).toBeNull();
});

test("search results tell the model where the reader is", async () => {
  const talk = harness();
  await talk.call("search_education", { query: "ADCs" });
  expect(talk.output("search_education").reader_is_on).toBe("wiki/education/dna");
});

test("model output cannot create a prompt or navigation for an unknown page", async () => {
  const talk = harness();
  await talk.call("suggest_page", { section_id: "https://attacker.test/", reason: "x" });
  await talk.call("open_page", { section_id: "/education/care-plan/" });
  expect(talk.view()?.suggestion ?? null).toBeNull();
  expect(talk.navigations).toEqual([]);
  expect(talk.output("suggest_page").error).toBeDefined();
  expect(talk.output("open_page").error).toBeDefined();
});

test("does not offer the page the reader is on", async () => {
  const talk = harness();
  await talk.call("suggest_page", { section_id: "/education/dna/", reason: "x" });
  expect(talk.output("suggest_page").status).toBe("already_here");
  expect(talk.view()?.suggestion ?? null).toBeNull();
});

test("tapping Yes navigates and continues the conversation", async () => {
  const talk = harness();
  await talk.call("suggest_page", { section_id: payload, reason: "x" });
  const before = talk.replies().length;
  talk.conversation.acceptSuggestion();
  await settle();
  expect(talk.navigations).toEqual([payload]);
  expect(talk.view().suggestion).toBeNull();
  expect(talk.notes().at(-1)).toContain('"The payload" section of "Antibody-drug conjugates"');
  expect(talk.replies()).toHaveLength(before + 1);
  // The route change Talk caused does not produce a second note.
  const notes = talk.notes().length;
  await talk.conversation.notePage("/education/adcs/");
  expect(talk.notes()).toHaveLength(notes);
});

test("tapping Yes during a reply waits for that reply to finish", async () => {
  const talk = harness();
  await talk.call("suggest_page", { section_id: payload, reason: "x" });
  talk.conversation.handle({ type: "response.created" });
  const before = talk.replies().length;
  talk.conversation.acceptSuggestion();
  await settle();
  expect(talk.navigations).toEqual([payload]);
  expect(talk.replies()).toHaveLength(before);
  talk.conversation.handle({ type: "response.done", response: { status: "completed", output: [] } });
  await settle();
  expect(talk.replies()).toHaveLength(before + 1);
});

test("tapping Not now clears the prompt and tells the model without interrupting", async () => {
  const talk = harness();
  await talk.call("suggest_page", { section_id: payload, reason: "x" });
  const before = talk.replies().length;
  talk.conversation.dismissSuggestion();
  expect(talk.view().suggestion).toBeNull();
  expect(talk.notes().at(-1)).toContain("Not now");
  expect(talk.replies()).toHaveLength(before);
});

test("a spoken yes opens the page, and a spoken no clears the prompt", async () => {
  const talk = harness();
  await talk.call("suggest_page", { section_id: payload, reason: "x" }, "s1");
  await talk.call("dismiss_suggestion", {}, "d1");
  expect(talk.view().suggestion).toBeNull();
  await talk.call("suggest_page", { section_id: payload, reason: "x" }, "s2");
  await talk.call("open_page", { section_id: payload }, "o1");
  expect(talk.navigations).toEqual([payload]);
  expect(talk.view().suggestion).toBeNull();
  expect(talk.output("o1").status).toBe("opened");
});

test("the reader's own navigation updates the model and clears a matching prompt", async () => {
  const talk = harness();
  talk.conversation.handle({ type: "session.created" });
  await settle();
  await talk.call("suggest_page", { section_id: payload, reason: "x" });
  await talk.conversation.notePage("/wiki/education/adcs");
  await settle();
  expect(talk.notes().at(-1)).toContain('"Antibody-drug conjugates"');
  expect(talk.view().suggestion).toBeNull();
  await talk.conversation.notePage("/education/search/");
  expect(talk.notes().at(-1)).toContain("not on a specific lesson");
});

test("an interrupted response runs no tools, and each call runs once", async () => {
  const talk = harness();
  talk.conversation.handle({ type: "response.done", response: { status: "cancelled", output: [{ type: "function_call", call_id: "c1", name: "open_page", arguments: JSON.stringify({ section_id: payload }) }] } });
  await settle();
  expect(talk.navigations).toEqual([]);
  await talk.call("open_page", { section_id: payload }, "c2");
  await talk.call("open_page", { section_id: payload }, "c2");
  expect(talk.navigations).toEqual([payload]);
});

test("malformed tool arguments return an error to the model", async () => {
  const talk = harness();
  talk.conversation.handle({ type: "response.done", response: { status: "completed", output: [{ type: "function_call", call_id: "bad", name: "open_page", arguments: "{oops" }] } });
  await settle();
  expect(talk.output("bad").error).toContain("JSON");
});

test("captions and status follow the turn, and barge-in clears the old caption", () => {
  const talk = harness();
  talk.conversation.handle({ type: "input_audio_buffer.speech_started" });
  expect(talk.view().status).toBe("hearing");
  talk.conversation.handle({ type: "input_audio_buffer.speech_stopped" });
  expect(talk.view().status).toBe("thinking");
  talk.conversation.handle({ type: "conversation.item.input_audio_transcription.completed", transcript: " What are ADCs? " });
  expect(talk.view().readerCaption).toBe("What are ADCs?");
  talk.conversation.handle({ type: "response.created" });
  talk.conversation.handle({ type: "response.output_audio_transcript.delta", delta: "They are " });
  talk.conversation.handle({ type: "response.output_audio_transcript.delta", delta: "targeted." });
  expect(talk.view()).toMatchObject({ status: "speaking", voiceCaption: "They are targeted." });
  talk.conversation.handle({ type: "response.output_audio_transcript.done", transcript: "They are targeted drugs." });
  expect(talk.view().voiceCaption).toBe("They are targeted drugs.");
  talk.conversation.handle({ type: "output_audio_buffer.stopped" });
  expect(talk.view().status).toBe("listening");
  talk.conversation.handle({ type: "input_audio_buffer.speech_started" });
  expect(talk.view()).toMatchObject({ status: "hearing", voiceCaption: "", readerCaption: "" });
});

test("nothing is sent after the call closes", async () => {
  const talk = harness();
  talk.conversation.close();
  talk.conversation.handle({ type: "session.created" });
  await talk.conversation.notePage("/education/adcs/");
  await settle();
  expect(talk.sent).toEqual([]);
});
