import type { TalkEvent } from "@oncobase/education/talk-transport";
import { LEFT_PAGE_NOTE, PAGE_TALK_GREETING, pageNote, pageTitle } from "./contract";

export type PageTalkStatus = "connecting" | "listening" | "hearing" | "thinking" | "speaking";
export type TalkPage = { slug: string; title: string };
/** What open_page found for the reader's words: a page, or a few near misses to offer. */
export type FoundPage = { page: TalkPage; alternatives?: string[] } | { page: null; suggestions?: string[] };
type FunctionCall = { type: "function_call"; call_id: string; name: string; arguments: string };
type RealtimeResponse = { status?: string; output?: Array<{ type: string }> };

const IGNORED_ERRORS = new Set(["conversation_already_has_active_response", "response_cancel_not_active"]);

/** Interprets Realtime events for a call about the reader's current page:
 * status for the avatar, page notes and the point_to_section tool. It holds
 * no React or WebRTC, so the protocol can be tested directly. */
export class PageConversation {
  private status: PageTalkStatus = "connecting";
  private started = false;
  private closed = false;
  private responseActive = false;
  private handledCalls = new Set<string>();
  private page: TalkPage | null;
  /** Bumped on every page change, so a slow page load can't note a page the reader already left. */
  private pageVersion = 0;
  /** Resolves when go_back's route change has noted the new page. */
  private pageArrived: (() => void) | null = null;

  constructor(private readonly deps: {
    send: (event: TalkEvent) => void;
    /** The page's markdown, or null when it can't be read. */
    loadPage: (slug: string) => Promise<string | null>;
    /** Scrolls the reader to a heading. Returns the heading it found, if any. */
    pointAt: (heading: string) => string | null;
    onStatus: (status: PageTalkStatus) => void;
    onActivity?: () => void;
    /** Picks the page the reader named (open_page). Doesn't navigate. */
    findPage?: (request: string) => Promise<FoundPage>;
    /** Shows a page the reader asked for; the route change then calls notePage. */
    navigate?: (slug: string) => void;
    /** Browser Back. False when there is nowhere to go back to. */
    goBack?: () => boolean;
  }, page: TalkPage | null) { this.page = page; }

  close() { this.closed = true; }

  handle(event: TalkEvent) {
    if (this.closed) return;
    switch (event.type) {
      case "session.created": void this.start(); break;
      case "input_audio_buffer.speech_started": this.deps.onActivity?.(); this.update("hearing"); break;
      case "input_audio_buffer.speech_stopped": this.update("thinking"); break;
      case "response.created":
        this.responseActive = true;
        if (this.status !== "hearing") this.update("thinking");
        break;
      case "response.output_audio_transcript.delta":
      case "output_audio_buffer.started":
        this.deps.onActivity?.();
        this.update("speaking");
        break;
      case "output_audio_buffer.stopped":
      case "output_audio_buffer.cleared":
        if (this.status === "speaking") this.update("listening");
        break;
      case "response.done": this.finishResponse(event.response as RealtimeResponse | undefined); break;
      case "error": {
        const error = event.error as { code?: string; message?: string } | undefined;
        if (!IGNORED_ERRORS.has(error?.code ?? "")) console.warn("[talk]", error?.code, error?.message);
        break;
      }
    }
  }

  /** The route changed. Null means the reader is on a screen without page text. */
  async notePage(page: TalkPage | null) {
    if (page?.slug === this.page?.slug) return;
    this.page = page;
    const version = ++this.pageVersion;
    if (!this.started) return;
    if (!page) this.note(LEFT_PAGE_NOTE);
    else {
      const note = await this.pageText(page, false);
      if (version !== this.pageVersion) return;
      this.note(note);
    }
    this.pageArrived?.();
  }

  /** The reader changed a selection on the page (a block, a slider, a view).
 * Sent as a quiet note, with no response, so the voice isn't interrupted. */
  noteState(text: string) {
    if (!this.started || this.closed || !text.trim()) return;
    this.note(`The reader changed what they have selected on this page. Use this for "this" and "here", and don't mention the change unless it helps.\n\n${text}`);
  }

  private async start() {
    if (this.started) return;
    this.started = true;
    const version = this.pageVersion;
    const page = this.page;
    if (page) {
      const note = await this.pageText(page, true);
      if (this.closed) return;
      // If the reader moved while this loaded, notePage sends the new page instead.
      if (version === this.pageVersion) this.note(note);
    } else this.note(LEFT_PAGE_NOTE);
    if (this.closed) return;
    this.update("listening");
    this.deps.send({ type: "response.create", response: { instructions: PAGE_TALK_GREETING, tool_choice: "none" } });
  }

  private async pageText(page: TalkPage, first: boolean) {
    return pageNote(await this.loadPage(page), first);
  }

  private async loadPage(page: TalkPage) {
    return { ...page, markdown: await this.deps.loadPage(page.slug).catch(() => null) };
  }

  private finishResponse(response?: RealtimeResponse) {
    this.responseActive = false;
    const calls = response?.status === "completed"
      ? (response.output ?? []).filter((item): item is FunctionCall => item.type === "function_call" && !this.handledCalls.has((item as FunctionCall).call_id))
      : [];
    if (!calls.length) {
      if (this.status === "thinking") this.update("listening");
      return;
    }
    for (const call of calls) this.handledCalls.add(call.call_id);
    void this.answerCalls(calls);
  }

  /** Runs the calls one at a time, in order (an opened page must be noted
   * before the next call sees it), then asks for the spoken follow-up once. */
  private async answerCalls(calls: FunctionCall[]) {
    for (const call of calls) {
      const output = await this.runTool(call).catch(() => ({ error: "The tool failed." }));
      if (this.closed) return;
      this.deps.send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: call.call_id, output: JSON.stringify(output) } });
    }
    this.deps.send({ type: "response.create" });
  }

  private async runTool(call: FunctionCall): Promise<object> {
    let args: Record<string, unknown>;
    try { args = JSON.parse(call.arguments || "{}") as Record<string, unknown>; }
    catch { return { error: "The arguments were not valid JSON." }; }
    switch (call.name) {
      case "point_to_section": {
        const found = this.deps.pointAt(String(args.heading ?? "").slice(0, 300));
        return found
          ? { status: "scrolled", heading: found, note: "Keep talking in at most 40 words. Don't mention the scrolling." }
          : { status: "not_found", note: "No heading on the page matched. Carry on without pointing." };
      }
      case "open_page": return this.openPage(String(args.request ?? "").trim().slice(0, 200));
      case "go_back": return this.goBack();
      default: return { error: `Unknown tool ${call.name}` };
    }
  }

  private async openPage(request: string) {
    if (!this.deps.findPage || !this.deps.navigate) return { status: "unavailable", note: "Opening pages isn't available here." };
    if (request.length < 2) return { status: "not_found", note: "Ask the reader which page they mean." };
    const found = await this.deps.findPage(request);
    if (!found.page) {
      return { status: "not_found", ...(found.suggestions?.length ? { suggestions: found.suggestions } : {}), note: "No page clearly matched. Say so, and offer the suggestions if there are any." };
    }
    const page = found.page;
    if (page.slug === this.page?.slug) return { status: "already_open", title: page.title, note: "The reader is already on this page." };
    // Claim the page before the route changes, so notePage doesn't note it twice.
    this.page = page;
    const version = ++this.pageVersion;
    this.deps.navigate(page.slug);
    const loaded = await this.loadPage(page);
    if (this.closed || version !== this.pageVersion) return { status: "opened", title: page.title };
    this.note(pageNote(loaded, false));
    return {
      status: "opened", title: pageTitle(loaded),
      ...(found.alternatives?.length ? { other_close_matches: found.alternatives } : {}),
      note: "Its text is now in the conversation. Name the page in one short sentence and carry on. If the reader meant another page, offer the other close matches.",
    };
  }

  private async goBack() {
    if (!this.deps.goBack) return { status: "unavailable", note: "Going back isn't available here." };
    const arrived = new Promise<void>(resolve => {
      this.pageArrived = resolve;
      setTimeout(resolve, 4_000);
    });
    if (!this.deps.goBack()) { this.pageArrived = null; return { status: "nowhere_to_go", note: "There is no earlier page in this visit." }; }
    await arrived;
    this.pageArrived = null;
    return { status: "went_back", ...(this.page ? { title: this.page.title } : {}), note: "The page's text is in the conversation. Name the page in one short sentence and carry on." };
  }

  private note(text: string) {
    if (this.closed) return;
    this.deps.send({ type: "conversation.item.create", item: { type: "message", role: "system", content: [{ type: "input_text", text }] } });
  }

  private update(status: PageTalkStatus) {
    if (status === this.status) return;
    this.status = status;
    this.deps.onStatus(status);
  }
}
