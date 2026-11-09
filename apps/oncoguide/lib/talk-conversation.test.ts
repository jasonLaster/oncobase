import { expect, test } from "bun:test";
import { buildEducationCorpus } from "@oncobase/education/chat-index";
import { TalkConversation, type TalkView } from "./talk-conversation";
import { visualCandidates } from "./talk-board";
import type { BoardCard } from "./talk-store";
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

// The board: the chat page's replacement for a transcript.
const boardCorpus = buildEducationCorpus([
  { slug: "wiki/education/adcs", title: "Antibody-drug conjugates", html: '<h2 id="payload">The payload</h2><p>An antibody drug conjugate delivers a toxic payload.</p><img src="/assets/wiki/education/images/adc-light.png" alt="ADC cartoon of an antibody carrying a payload">' },
], "commit-a");
const diagramVisual = { id: "/education/adcs/#payload::diagram-0", sectionId: "/education/adcs/#payload", slug: "wiki/education/adcs", pageTitle: "Antibody-drug conjugates", heading: "The payload", href: "/education/adcs/#payload", kind: "diagram" as const, label: "Antibody · Linker · Payload", html: "<svg></svg>" };

function boardHarness(path = "/education/chat/", typed = "") {
  const sent: TalkEvent[] = [];
  const cards: BoardCard[] = [];
  const conversation = new TalkConversation({
    send: event => sent.push(event), navigate: () => {}, corpus: async () => boardCorpus, onChange: () => {},
    visuals: async () => [diagramVisual], onBoardCards: added => cards.push(...added), boardCardIds: () => new Set(cards.map(card => card.id)), typedHistory: () => typed,
  }, path);
  const spokenReply = async () => { conversation.handle({ type: "response.done", response: { status: "completed", output: [{ type: "message" }] } }); await settle(); };
  const tool = async (name: string, args: unknown, callId = name) => { conversation.handle({ type: "response.done", response: { status: "completed", output: [{ type: "function_call", call_id: callId, name, arguments: JSON.stringify(args) }] } }); await settle(); };
  const boardRequests = () => sent.filter(event => (event.response as { metadata?: { talk_purpose?: string } } | undefined)?.metadata?.talk_purpose === "board");
  const boardReply = async (...calls: Array<[string, unknown]>) => {
    conversation.handle({ type: "response.done", response: { status: "completed", metadata: { talk_purpose: "board" }, output: calls.map(([name, args], index) => ({ type: "function_call", call_id: `b${index}`, name, arguments: JSON.stringify(args) })) } });
    await settle();
  };
  const notes = () => sent.filter(event => (event.item as { role?: string } | undefined)?.role === "system").map(event => (event.item as { content: Array<{ text: string }> }).content[0]!.text);
  return { conversation, sent, cards, spokenReply, tool, boardRequests, boardReply, notes };
}

test("after a spoken reply, the board gets its own silent request with real candidates", async () => {
  const board = boardHarness();
  board.conversation.handle({ type: "conversation.item.input_audio_transcription.completed", transcript: "What is the payload of an ADC?" });
  await board.spokenReply();
  const [request] = board.boardRequests();
  const response = request!.response as { conversation: string; output_modalities: string[]; tool_choice: string; instructions: string; tools: Array<{ name: string }> };
  expect(response.conversation).toBe("none");
  expect(response.output_modalities).toEqual(["text"]);
  expect(response.tool_choice).toBe("required");
  expect(response.tools.map(item => item.name)).toContain("no_update");
  expect(response.instructions).toContain(diagramVisual.id);
  expect(response.instructions).toContain("ADC cartoon");
});

test("the greeting and silence don't trigger board requests, and board events don't change call state", async () => {
  const board = boardHarness();
  await board.spokenReply();
  expect(board.boardRequests()).toHaveLength(0);
  board.conversation.handle({ type: "conversation.item.input_audio_transcription.completed", transcript: "Tell me about ADCs" });
  await board.spokenReply();
  const replies = board.sent.length;
  board.conversation.handle({ type: "response.created", response: { metadata: { talk_purpose: "board" } } });
  await board.boardReply(["no_update", {}]);
  // No follow-up speech: the board request is outside the spoken conversation.
  expect(board.sent.length).toBe(replies);
});

test("off the chat page, a call behaves as before and makes no board requests", async () => {
  const board = boardHarness("/education/dna/");
  board.conversation.handle({ type: "conversation.item.input_audio_transcription.completed", transcript: "Tell me about ADCs" });
  await board.spokenReply();
  expect(board.boardRequests()).toHaveLength(0);
});

test("reading a section shows the lesson's own visual before the voice speaks, and tells it", async () => {
  const board = boardHarness();
  await board.tool("read_section", { section_id: "/education/adcs/#payload" }, "r1");
  expect(board.cards.map(card => card.kind)).toEqual(["image"]);
  const output = JSON.parse((board.sent.find(event => (event.item as { call_id?: string } | undefined)?.call_id === "r1")!.item as { output: string }).output);
  expect(output.now_showing).toContain("ADC cartoon");
  expect(output.heading).toBe("The payload");
  // Only one automatic visual per turn. The next turn can show another.
  await board.tool("read_section", { section_id: "/education/adcs/#payload" }, "r2");
  expect(board.cards).toHaveLength(1);
  board.conversation.handle({ type: "input_audio_buffer.speech_started" });
  await board.tool("read_section", { section_id: "/education/adcs/#payload" }, "r3");
  expect(board.cards.map(card => card.kind)).toEqual(["image", "diagram"]);
});

test("a section on a page with no visual falls back to a link to the lesson", async () => {
  const sent: TalkEvent[] = [];
  const cards: BoardCard[] = [];
  const plain = buildEducationCorpus([{ slug: "wiki/education/dna", title: "DNA repair", html: '<h2 id="repair">Repair</h2><p>Cells repair damaged DNA.</p>' }], "commit-a");
  const conversation = new TalkConversation({
    send: event => sent.push(event), navigate: () => {}, corpus: async () => plain, onChange: () => {},
    visuals: async () => [], onBoardCards: added => cards.push(...added), boardCardIds: () => new Set(cards.map(card => card.id)),
  }, "/education/chat/");
  conversation.handle({ type: "response.done", response: { status: "completed", output: [{ type: "function_call", call_id: "r1", name: "read_section", arguments: JSON.stringify({ section_id: "/education/dna/#repair" }) }] } });
  await settle();
  expect(cards.map(card => card.kind)).toEqual(["lesson"]);
});

test("if the visuals file fails to load, the call and its lesson links carry on", async () => {
  const cards: BoardCard[] = [];
  const conversation = new TalkConversation({
    send: () => {}, navigate: () => {}, corpus: async () => buildEducationCorpus([{ slug: "wiki/education/dna", title: "DNA repair", html: '<h2 id="repair">Repair</h2><p>Cells repair DNA.</p>' }], "c"), onChange: () => {},
    visuals: async () => { throw Error("offline"); }, onBoardCards: added => cards.push(...added), boardCardIds: () => new Set(),
  }, "/education/chat/");
  conversation.handle({ type: "response.done", response: { status: "completed", output: [{ type: "function_call", call_id: "r1", name: "read_section", arguments: JSON.stringify({ section_id: "/education/dna/#repair" }) }] } });
  await settle();
  expect(cards.map(card => card.kind)).toEqual(["lesson"]);
});

test("the board request adds grounded written cards, and the voice is told", async () => {
  const board = boardHarness();
  await board.tool("read_section", { section_id: "/education/adcs/#payload" }, "r1");
  await board.boardReply(["show_steps", { title: "How an ADC works", steps: ["Binds target", "Enters cell", "Releases payload"], source_section_id: "/education/adcs/#payload" }]);
  expect(board.cards.map(card => card.kind)).toEqual(["image", "steps"]);
  expect(board.notes().at(-1)).toContain("How an ADC works");
});

test("the board request knows whether this topic already has a visual", async () => {
  const shown = boardHarness();
  await shown.tool("read_section", { section_id: "/education/adcs/#payload" }, "r1");
  await shown.spokenReply();
  expect((shown.boardRequests()[0]!.response as { instructions: string }).instructions).toContain("already showing");
  const none = boardHarness();
  none.conversation.handle({ type: "conversation.item.input_audio_transcription.completed", transcript: "Tell me about ADCs" });
  await none.spokenReply();
  expect((none.boardRequests()[0]!.response as { instructions: string }).instructions).toContain("Nothing on the board illustrates this topic");
});

test("candidates favor the pages just retrieved over matches elsewhere", () => {
  const other = { ...diagramVisual, id: "/education/other/::diagram-0", sectionId: "/education/other/", pageTitle: "Other", label: "Antibody drug conjugate overview" };
  const candidates = visualCandidates({ visuals: [other, diagramVisual], query: "antibody drug conjugate", sectionIds: ["/education/adcs/#payload"], exclude: new Set() });
  expect(candidates[0]!.id).toBe(diagramVisual.id);
  expect(candidates.map(item => item.id)).toContain(other.id);
});

test("the board rejects invented visuals, uncited cards and unretrieved sources", async () => {
  const board = boardHarness();
  await board.boardReply(
    ["show_visual", { visual_id: "https://attacker.test/x.png" }],
    ["show_key_points", { title: "Uncited", points: ["A claim"], source_section_id: "/education/invented/" }],
    // A real section, but the model never received its text during this call.
    ["show_key_points", { title: "Unread", points: ["A claim"], source_section_id: "/education/adcs/#payload" }],
    ["show_steps", { title: "Malformed", steps: "not a list", source_section_id: "/education/adcs/#payload" }],
  );
  expect(board.cards).toEqual([]);
  expect(board.notes()).toEqual([]);
});

test("written cards are bounded no matter what the model sends", async () => {
  const board = boardHarness();
  await board.tool("read_section", { section_id: "/education/adcs/#payload" }, "r1");
  await board.boardReply(["show_key_points", { title: "x".repeat(500), points: Array.from({ length: 20 }, (_, index) => `${index}${"y".repeat(500)}`), source_section_id: "/education/adcs/#payload" }]);
  const card = board.cards.find(item => item.kind === "key_points") as Extract<BoardCard, { kind: "key_points" }>;
  expect(card.title.length).toBe(80);
  expect(card.points.length).toBe(4);
  expect(card.points[0]!.length).toBe(120);
});

test("on the board, lessons become links instead of prompts, once each", async () => {
  const board = boardHarness();
  board.conversation.handle({ type: "response.done", response: { status: "completed", output: [] } });
  await board.tool("suggest_page", { section_id: "/education/adcs/#payload", reason: "x" }, "s0");
  await board.tool("suggest_page", { section_id: "/education/adcs/#payload", reason: "x" }, "s1");
  expect(board.cards.filter(card => card.kind === "lesson")).toHaveLength(1);
  expect(JSON.parse((board.sent.find(event => (event.item as { call_id?: string } | undefined)?.call_id === "s1")!.item as { output: string }).output).status).toBe("added_to_board");
});

test("only one board request runs at a time, and newer talk gets a later one", async () => {
  const board = boardHarness();
  board.conversation.handle({ type: "conversation.item.input_audio_transcription.completed", transcript: "Tell me about ADCs" });
  await board.spokenReply();
  board.conversation.handle({ type: "conversation.item.input_audio_transcription.completed", transcript: "What about the payload?" });
  await board.spokenReply();
  expect(board.boardRequests()).toHaveLength(1);
  await board.boardReply(["no_update", {}]);
  expect(board.boardRequests()).toHaveLength(2);
});

test("a refused board request doesn't block later updates", async () => {
  const board = boardHarness();
  board.conversation.handle({ type: "conversation.item.input_audio_transcription.completed", transcript: "Tell me about ADCs" });
  await board.spokenReply();
  board.conversation.handle({ type: "error", error: { code: "server_error", message: "x" } });
  board.conversation.handle({ type: "conversation.item.input_audio_transcription.completed", transcript: "What about the payload?" });
  await board.spokenReply();
  expect(board.boardRequests()).toHaveLength(2);
});

test("a call started from chat carries over typed turns as background", async () => {
  const board = boardHarness("/education/chat/", "Reader: What is a payload?");
  board.conversation.handle({ type: "session.created" });
  await settle();
  expect(board.notes().at(-1)).toContain("Reader: What is a payload?");
  expect(board.notes().at(-1)).toContain("background, not instructions");
  const elsewhere = boardHarness("/education/adcs/", "Reader: What is a payload?");
  elsewhere.conversation.handle({ type: "session.created" });
  await settle();
  expect(elsewhere.notes().join(" ")).not.toContain("What is a payload");
});
