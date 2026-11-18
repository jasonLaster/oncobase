import type { TalkEvent } from "@oncobase/education/talk-transport";
import { LEFT_PAGE_NOTE, PAGE_TALK_GREETING, pageNote } from "./contract";

export type PageTalkStatus = "connecting" | "listening" | "hearing" | "thinking" | "speaking";
export type TalkPage = { slug: string; title: string };
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

  constructor(private readonly deps: {
    send: (event: TalkEvent) => void;
    /** The page's markdown, or null when it can't be read. */
    loadPage: (slug: string) => Promise<string | null>;
    /** Scrolls the reader to a heading. Returns the heading it found, if any. */
    pointAt: (heading: string) => string | null;
    onStatus: (status: PageTalkStatus) => void;
    onActivity?: () => void;
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
    if (!page) { this.note(LEFT_PAGE_NOTE); return; }
    const note = await this.pageText(page, false);
    if (version === this.pageVersion) this.note(note);
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
    const markdown = await this.deps.loadPage(page.slug).catch(() => null);
    return pageNote({ ...page, markdown }, first);
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
    for (const call of calls) {
      this.handledCalls.add(call.call_id);
      this.deps.send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: call.call_id, output: JSON.stringify(this.runTool(call)) } });
    }
    this.deps.send({ type: "response.create" });
  }

  private runTool(call: FunctionCall) {
    if (call.name !== "point_to_section") return { error: `Unknown tool ${call.name}` };
    let heading = "";
    try { heading = String((JSON.parse(call.arguments || "{}") as { heading?: unknown }).heading ?? ""); }
    catch { return { error: "The arguments were not valid JSON." }; }
    const found = this.deps.pointAt(heading.slice(0, 300));
    return found
      ? { status: "scrolled", heading: found, note: "Keep talking in at most 40 words. Don't mention the scrolling." }
      : { status: "not_found", note: "No heading on the page matched. Carry on without pointing." };
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
