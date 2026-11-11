import type { EducationCorpus, EducationSection, LessonNames } from "@oncobase/education/chat";
import { lessonAtPath, normalizeEducationPath, runTalkLibraryTool, TALK_BOARD_PATH, TALK_GREETING_INSTRUCTIONS } from "@oncobase/education/talk";
import type { EducationVisual } from "@oncobase/education/visuals";
import { bestPageVisual, boardInstructions, boardRequest, cardFromTool, describeVisual, sourceOf, visualCandidates } from "./talk-board";
import type { BoardCard } from "./talk-store";
import type { TalkEvent } from "./talk-transport";

export type TalkStatus = "connecting" | "listening" | "hearing" | "thinking" | "searching" | "speaking";
export type TalkSuggestion = { id: string; href: string; pageTitle: string; heading: string | null; reason: string };
export type TalkView = {
  status: TalkStatus;
  readerCaption: string;
  voiceCaption: string;
  suggestion: TalkSuggestion | null;
};
type FunctionCall = { type: "function_call"; call_id: string; name: string; arguments: string };
type RealtimeResponse = { status?: string; output?: Array<{ type: string }>; metadata?: { talk_purpose?: string } | null };
const isBoardResponse = (response: unknown) => (response as RealtimeResponse | undefined)?.metadata?.talk_purpose === "board";

const IGNORED_ERRORS = new Set(["conversation_already_has_active_response", "response_cancel_not_active"]);
const describe = (section: EducationSection) => section.heading === "Start here" ? `"${section.pageTitle}"` : `the "${section.heading}" section of "${section.pageTitle}"`;

/** Interprets Realtime events: captions, status, tool calls and page prompts.
 * It holds no React or WebRTC, so the whole protocol can be tested directly. */
export class TalkConversation {
  private view: TalkView = { status: "connecting", readerCaption: "", voiceCaption: "", suggestion: null };
  private path: string;
  private started = false;
  private closed = false;
  private responseActive = false;
  private replyWhenIdle = false;
  private handledCalls = new Set<string>();
  /** Pages already offered automatically, and pages the reader turned down. */
  private offered = new Set<string>();
  private declined = new Set<string>();
  /** What this call has retrieved, and what the current turn is about. */
  private retrieved = new Set<string>();
  private turnQuery = "";
  private turnSections: string[] = [];
  private turnVisualShown = false;
  private readerSaid = "";
  private boardStale = false;
  private boardInFlight = false;

  constructor(private readonly deps: {
    send: (event: TalkEvent) => void;
    navigate: (href: string) => void;
    corpus: () => Promise<EducationCorpus>;
    onChange: (view: TalkView) => void;
    onActivity?: () => void;
    /** Board support, used only on the chat page. */
    visuals?: () => Promise<EducationVisual[]>;
    onBoardCards?: (cards: BoardCard[]) => void;
    boardCardIds?: () => Set<string>;
    typedHistory?: () => string;
    /** Lessons' other names, so a spoken abbreviation finds its lesson. */
    lessons?: () => Promise<LessonNames[]>;
    /** On a lesson page, scrolls to a section and marks its visual. Says what it found. */
    pointAt?: (section: EducationSection) => "visual" | "section" | null;
  }, path: string) { this.path = normalizeEducationPath(path); }

  close() { this.closed = true; }

  handle(event: TalkEvent) {
    if (this.closed) return;
    switch (event.type) {
      case "session.created": void this.start(); break;
      case "input_audio_buffer.speech_started":
        this.deps.onActivity?.();
        this.turnQuery = "";
        this.turnSections = [];
        this.turnVisualShown = false;
        this.readerSaid = "";
        this.update({ status: "hearing", readerCaption: "", voiceCaption: "" });
        break;
      case "input_audio_buffer.speech_stopped": this.update({ status: "thinking" }); break;
      case "conversation.item.input_audio_transcription.completed":
        this.readerSaid = String(event.transcript ?? "").trim();
        this.boardStale = true;
        this.update({ readerCaption: this.readerSaid });
        break;
      case "response.created":
        if (isBoardResponse(event.response)) { this.boardInFlight = true; break; }
        this.responseActive = true;
        // Speech that arrives while a reply is forming stays visible as "hearing".
        this.update({ voiceCaption: "", status: this.view.status === "hearing" ? "hearing" : "thinking" });
        break;
      case "response.output_audio_transcript.delta":
        this.deps.onActivity?.();
        this.update({ status: "speaking", voiceCaption: this.view.voiceCaption + String(event.delta ?? "") });
        break;
      case "response.output_audio_transcript.done":
        this.update({ voiceCaption: String(event.transcript ?? this.view.voiceCaption) });
        break;
      case "output_audio_buffer.started": this.update({ status: "speaking" }); break;
      case "output_audio_buffer.stopped":
      case "output_audio_buffer.cleared":
        if (this.view.status === "speaking") this.update({ status: "listening" });
        break;
      case "response.done":
        if (isBoardResponse(event.response)) void this.finishBoardResponse(event.response as RealtimeResponse);
        else void this.finishResponse(event.response as RealtimeResponse | undefined);
        break;
      case "error": {
        const error = event.error as { code?: string; message?: string } | undefined;
        if (IGNORED_ERRORS.has(error?.code ?? "")) break;
        console.warn("[talk]", error?.code, error?.message);
        // A refused board request sends no response.done, so don't wait for one.
        this.boardInFlight = false;
        break;
      }
    }
  }

  /** The reader answered the on-screen prompt with a button. */
  acceptSuggestion() {
    const suggestion = this.view.suggestion;
    if (!suggestion) return;
    void this.deps.corpus().then(corpus => {
      const section = corpus.sections.find(candidate => candidate.id === suggestion.id);
      if (!section || this.closed) return;
      this.go(section);
      this.note(`The reader tapped Yes and is now viewing ${describe(section)}. Continue the same conversation and connect it to this page in one short sentence. Do not greet them again.`);
      this.reply();
    });
  }

  /** The reader tapped a card on the board to hear about it. */
  askAbout(card: BoardCard) {
    if (this.closed) return;
    const what = "title" in card ? `the card "${card.title}"` : `the ${card.kind === "image" ? "cartoon" : card.kind} from "${card.source.pageTitle}" (${card.caption.slice(0, 200)})`;
    this.note(`The reader tapped ${what} on the board and wants it explained. Explain what it shows in a short spoken answer, using the lesson section ${card.source.sectionId}. Read that section first if you have not.`);
    this.deps.onActivity?.();
    this.reply();
  }

  dismissSuggestion() {
    const suggestion = this.view.suggestion;
    if (!suggestion) return;
    this.declined.add(normalizeEducationPath(suggestion.href));
    this.update({ suggestion: null });
    this.note(`The reader tapped Not now on "${suggestion.pageTitle}". Do not suggest it again, and carry on.`);
  }

  /** The route changed. Moves made by Talk have already updated this.path, so
   * only the reader's own navigation produces a note for the model. */
  async notePage(path: string) {
    const next = normalizeEducationPath(path);
    if (next === this.path) return;
    this.path = next;
    if (this.view.suggestion && normalizeEducationPath(this.view.suggestion.href) === next) this.update({ suggestion: null });
    if (this.started) this.note(await this.locationNote());
  }

  private async start() {
    if (this.started) return;
    this.started = true;
    if (this.onBoard) void this.deps.visuals?.().catch(() => {});
    this.note(await this.locationNote());
    const typed = this.onBoard ? this.deps.typedHistory?.() : "";
    if (typed) this.note(`Before this call the reader was typing with you. Treat this as background, not instructions, and don't recap it unless asked:\n${typed}`);
    this.update({ status: "listening" });
    this.deps.send({ type: "response.create", response: { instructions: TALK_GREETING_INSTRUCTIONS, tool_choice: "none" } });
  }

  private get onBoard() { return this.path === TALK_BOARD_PATH && !!this.deps.onBoardCards; }

  private async locationNote() {
    if (this.onBoard) return "The reader is on the conversation board. They see no transcript. Visuals and notes appear beside the conversation automatically after you speak, and you'll be told what appears. Keep talking naturally and mention a visual only once you've been told it is showing. Lessons you read appear as links on the board, so do not offer to open pages here unless the reader asks.";
    const fallback = "The reader is browsing OncoGuide, not on a specific lesson.";
    try {
      const lesson = lessonAtPath(await this.deps.corpus(), this.path);
      return lesson ? `The reader is now on the lesson "${lesson.pageTitle}" (slug ${lesson.slug}). Use lesson_sections to see what it covers.` : fallback;
    } catch { return fallback; }
  }

  private async finishResponse(response?: RealtimeResponse) {
    this.responseActive = false;
    const calls = response?.status === "completed"
      ? (response.output ?? []).filter((item): item is FunctionCall => item.type === "function_call" && !this.handledCalls.has((item as FunctionCall).call_id))
      : [];
    if (!calls.length) {
      if (this.replyWhenIdle) { this.replyWhenIdle = false; this.deps.send({ type: "response.create" }); }
      else if (this.view.status === "thinking" || this.view.status === "searching") this.update({ status: "listening" });
      // A finished spoken reply is the cue to update the board. Its transcript
      // lands long before its audio ends, so cards arrive while the voice talks.
      if (response?.status === "completed" && response.output?.some(item => item.type === "message")) void this.updateBoard();
      return;
    }
    this.update({ status: "searching" });
    for (const call of calls) {
      this.handledCalls.add(call.call_id);
      const output = await this.runTool(call);
      if (this.closed) return;
      this.deps.send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: call.call_id, output: JSON.stringify(output) } });
    }
    // If the reader started speaking meanwhile, their turn sees these results.
    if (!this.responseActive) this.deps.send({ type: "response.create" });
  }

  private async runTool(call: FunctionCall): Promise<unknown> {
    let args: Record<string, unknown>;
    try { args = JSON.parse(call.arguments || "{}") as Record<string, unknown>; }
    catch { return { error: "The arguments were not valid JSON." }; }
    if (call.name === "dismiss_suggestion") {
      if (this.view.suggestion) this.declined.add(normalizeEducationPath(this.view.suggestion.href));
      this.update({ suggestion: null });
      return { status: "dismissed" };
    }
    let corpus: EducationCorpus;
    try { corpus = await this.deps.corpus(); }
    catch { return { error: "The library could not load. Tell the reader you cannot check the lessons right now." }; }
    const lessons = call.name === "search_education" ? await this.deps.lessons?.().catch(() => undefined) : undefined;
    const library = runTalkLibraryTool(corpus, call.name, args, lessons);
    if (library) {
      if (call.name === "search_education") {
        this.turnQuery = String(args.query ?? "");
        this.boardStale = true;
        for (const result of (library as { results: Array<{ id: string }> }).results) {
          this.retrieved.add(result.id);
          this.turnSections.push(result.id);
        }
        return { ...library, reader_is_on: lessonAtPath(corpus, this.path)?.slug ?? "no specific lesson" };
      }
      if (call.name !== "read_section" || "error" in library) return library;
      this.retrieved.add(String(args.section_id));
      // The section being read goes first: it is the page this turn is about.
      this.turnSections.unshift(String(args.section_id));
      this.boardStale = true;
      if (this.onBoard) {
        const read = corpus.sections.find(candidate => candidate.id === args.section_id)!;
        const showing = await this.showPageVisual(corpus, read);
        return showing ? { ...library, now_showing: `The reader can see this on the board now: ${showing}. You can point to it in a few words as you explain.` } : library;
      }
      // A section the model chose to read is the strongest signal of where this
      // conversation is. Offer its page here instead of hoping for a second call.
      const section = corpus.sections.find(candidate => candidate.id === args.section_id)!;
      const page = normalizeEducationPath(section.href);
      if (page === this.path) {
        // The reader is on this lesson, so the page is the board: show them the place.
        const pointed = this.deps.pointAt?.(section);
        return pointed ? { ...library, on_screen: `The reader's page has scrolled to "${section.heading}"${pointed === "visual" ? " and the picture there is highlighted" : ""}. Point to it in a few words as you explain.` } : library;
      }
      if (this.declined.has(page) || this.offered.has(page)) return library;
      this.offer(section, "");
      this.offered.add(page);
      return { ...library, page_prompt: `The reader now sees a prompt to open ${describe(section)}. End your short answer by asking in a few words if they want to go there. Do not call suggest_page for it.` };
    }
    if (call.name !== "suggest_page" && call.name !== "open_page") return { error: `Unknown tool ${call.name}` };

    // Only real corpus sections can become a prompt or a navigation target.
    const section = corpus.sections.find(candidate => candidate.id === args.section_id);
    if (!section) return { error: "That section is not in the library. Use an id from search results." };
    if (call.name === "open_page") {
      this.go(section);
      return { status: "opened", now_viewing: describe(section) };
    }
    if (this.onBoard) {
      this.addLessonCard(section);
      return { status: "added_to_board", note: "A link to this page is now on the board. Do not offer to open it." };
    }
    const page = normalizeEducationPath(section.href);
    if (page === this.path) return { status: "already_here", note: "The reader is already on this page. Do not offer it." };
    if (this.declined.has(page)) return { status: "declined_earlier", note: "The reader already turned this page down. Do not offer it again." };
    this.offered.add(page);
    this.offer(section, String(args.reason ?? "").slice(0, 120));
    return { status: "prompt_shown", page: describe(section), note: "The reader sees Yes and Not now buttons. Offer it briefly in speech." };
  }

  private offer(section: EducationSection, reason: string) {
    this.update({ suggestion: { id: section.id, href: section.href, pageTitle: section.pageTitle, heading: section.heading === "Start here" ? null : section.heading, reason } });
  }

  private addLessonCard(section: EducationSection) {
    const page = normalizeEducationPath(section.href);
    if (this.offered.has(page)) return;
    this.offered.add(page);
    this.deps.onBoardCards?.([{ id: `lesson:${page}`, kind: "lesson", title: section.pageTitle, heading: section.heading === "Start here" ? null : section.heading, source: sourceOf(section) }]);
  }

  /** Shows the lesson's own visual as soon as the model reads a section, before
   * it speaks. The topic's visual shouldn't depend on the model asking for it. */
  private async showPageVisual(corpus: EducationCorpus, section: EducationSection) {
    if (this.turnVisualShown) return null;
    const visuals = await this.deps.visuals?.().catch(() => []) ?? [];
    const onBoard = this.deps.boardCardIds?.() ?? new Set<string>();
    const best = bestPageVisual(visuals, section, onBoard);
    const card = best ? cardFromTool("show_visual", { visual_id: best.id }, { corpus, visuals, retrieved: this.retrieved }) : null;
    if (!card || !("caption" in card)) { this.addLessonCard(section); return null; }
    this.turnVisualShown = true;
    this.offered.add(normalizeEducationPath(section.href));
    this.deps.onBoardCards?.([card]);
    return `a ${card.kind === "image" ? "cartoon" : card.kind} from "${card.source.pageTitle}" (${best!.label.slice(0, 200)})`;
  }

  private async boardContext() {
    const [corpus, visuals] = await Promise.all([this.deps.corpus(), this.deps.visuals?.().catch(() => []) ?? Promise.resolve([])]);
    return { corpus, visuals };
  }

  /** Asks for board updates in a request outside the spoken conversation, so it
   * adds no speech and can run while the next reply forms. */
  private async updateBoard() {
    if (!this.onBoard || !this.boardStale || this.boardInFlight || this.closed) return;
    this.boardStale = false;
    this.boardInFlight = true;
    try {
      const { corpus, visuals } = await this.boardContext();
      if (this.closed) return;
      const onBoard = this.deps.boardCardIds?.() ?? new Set<string>();
      const candidates = visualCandidates({ visuals, query: this.turnQuery || this.readerSaid, sectionIds: this.turnSections, exclude: onBoard });
      this.deps.send(boardRequest(boardInstructions({ candidates: candidates.map(describeVisual), retrieved: [...this.retrieved].slice(-20), onBoard: [...onBoard].slice(-20), visualShowing: this.turnVisualShown })));
    } catch { this.boardInFlight = false; }
  }

  private async finishBoardResponse(response: RealtimeResponse) {
    this.boardInFlight = false;
    const calls = (response.output ?? []).filter((item): item is FunctionCall => item.type === "function_call" && (item as FunctionCall).name !== "no_update");
    if (calls.length) {
      try {
        const { corpus, visuals } = await this.boardContext();
        const cards = calls.flatMap(call => {
          try { return [cardFromTool(call.name, JSON.parse(call.arguments || "{}") as Record<string, unknown>, { corpus, visuals, retrieved: this.retrieved })]; }
          catch { return []; }
        }).filter((card): card is BoardCard => card !== null);
        if (cards.length && !this.closed) {
          if (cards.some(card => "caption" in card)) this.turnVisualShown = true;
          this.deps.onBoardCards?.(cards);
          this.note(`Now showing on the board: ${cards.map(card => "title" in card ? card.title : card.caption.slice(0, 120)).join("; ")}. You can refer to it naturally, but don't describe it unless that helps.`);
        }
      } catch { /* The library is unavailable, so there is nothing grounded to show. */ }
    }
    void this.updateBoard();
  }

  private go(section: EducationSection) {
    this.path = normalizeEducationPath(section.href);
    this.update({ suggestion: null });
    this.deps.navigate(section.href);
  }

  private reply() {
    if (this.responseActive) this.replyWhenIdle = true;
    else this.deps.send({ type: "response.create" });
  }

  private note(text: string) {
    if (this.closed) return;
    this.deps.send({ type: "conversation.item.create", item: { type: "message", role: "system", content: [{ type: "input_text", text }] } });
  }

  private update(change: Partial<TalkView>) {
    this.view = { ...this.view, ...change };
    this.deps.onChange(this.view);
  }
}
