import { safeLocalStorage } from "@oncobase/safe-storage";
import { connectTalk, TalkStartError, type TalkEvent, type TalkFailure, type TalkTransport } from "@oncobase/education/talk-transport";
import { formatFileLabel } from "@oncobase/wiki-content/file-labels";
import { Button } from "@oncobase/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@oncobase/ui/dialog";
import { Toggle } from "@oncobase/ui/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@oncobase/ui/tooltip";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import { EMPTY_READER_ROWS, readerQuery, useInitialReaderData, useReaderQuery } from "../bootstrap/reader-queries";
import type { PageIndexRow } from "../types";
import { useWikiScope } from "../wiki-context";
import { isDocumentRoute } from "../shell/document-routes";
import { appTalkPage, appTalkStateNote, loadAppTalkText } from "./talk-pages";
import { contentSlugFromRouteSlug, hrefForSlug, slugFromPath } from "../wiki-utils";
import { findTalkPage } from "./find-page";
import { PageConversation, type PageTalkStatus, type TalkPage } from "./page-conversation";
import { TalkAvatar } from "./TalkAvatar";
import talkCss from "./talk.css?inline";

// The reader ships one eager stylesheet (cssCodeSplit is off), so the call's
// styles arrive with the call code instead of with every page.
if (typeof document !== "undefined" && !document.getElementById("wiki-vite-talk-css")) {
  const style = document.createElement("style");
  style.id = "wiki-vite-talk-css";
  style.textContent = talkCss;
  document.head.append(style);
}

/** Small inline icons: lucide here would land in the reader's eager icon chunk. */
const Icon = ({ size, children }: { size: number; children: ReactNode }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
const MIC = <><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4" /></>;
const Mic = ({ size }: { size: number }) => <Icon size={size}>{MIC}</Icon>;
const MicOff = ({ size }: { size: number }) => <Icon size={size}>{MIC}<path d="m2 2 20 20" /></Icon>;
const X = ({ size }: { size: number }) => <Icon size={size}><path d="M18 6 6 18M6 6l12 12" /></Icon>;
// Path data from lucide's "phone-off" (ISC).
const PhoneOff = ({ size }: { size: number }) => <Icon size={size}><path d="M10.1 13.9a14 14 0 0 0 3.732 2.668 1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2 18 18 0 0 1-12.728-5.272" /><path d="M22 2 2 22" /><path d="M4.76 13.582A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 .244.473" /></Icon>;
/** How long the avatar takes to shrink away after hanging up. */
const LEAVE_MS = 200;

const CONSENT_KEY = "oncobase:talk-consent";
const IDLE_LIMIT_MS = 5 * 60_000;
const CALL_LIMIT_MS = 30 * 60_000;
const TALK_API = "/api/wiki/talk";
const STATUS_LABEL: Record<PageTalkStatus, string> = { connecting: "Connecting…", listening: "Listening", hearing: "Listening", thinking: "Thinking…", speaking: "Speaking" };
const FAILURE_MESSAGE: Record<TalkFailure, string> = {
  unsupported: "This browser can’t make voice calls. Try a recent version of Chrome, Safari, Edge or Firefox.",
  "mic-denied": "Talk needs your microphone. Allow it in your browser’s site settings, then try again.",
  "no-mic": "No microphone was found. Connect one, then try again.",
  busy: "Talk is busy right now. Please try again in a few minutes.",
  unavailable: "Talk isn’t available right now.",
  network: "Talk couldn’t connect. Check your connection and try again.",
};
type Ended = { message: string; retry: boolean };

const readConsent = () => { try { return safeLocalStorage.getItem(CONSENT_KEY) === "1"; } catch { return false; } };
const saveConsent = () => { try { safeLocalStorage.setItem(CONSENT_KEY, "1"); } catch { /* Ask again next time. */ } };

export function talkPageForPath(pathname: string): TalkPage | null {
  const app = appTalkPage(pathname);
  if (app) return app;
  if (!isDocumentRoute(pathname)) return null;
  const slug = contentSlugFromRouteSlug(slugFromPath(pathname));
  return { slug, title: formatFileLabel(slug.split("/").at(-1) ?? slug) };
}

/** The page's markdown, through the same access rules and redactions as Copy page. */
async function loadPageMarkdown(slug: string) {
  const appText = await loadAppTalkText(slug);
  if (appText !== undefined) return appText;
  const response = await fetch(`/api/page-copy?${new URLSearchParams({ slug })}`, { credentials: "same-origin" });
  return response.ok ? response.text() : null;
}

const normalizeHeading = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Scrolls the article to the heading the voice is talking about. */
export function pointAtHeading(heading: string, root: ParentNode = document) {
  const wanted = normalizeHeading(heading);
  if (!wanted) return null;
  const headings = [...root.querySelectorAll<HTMLElement>(':is([data-test-id="document-article"], [data-test-id="cellularity-page"]) :is(h1, h2, h3, h4)')];
  const match = headings.find(element => normalizeHeading(element.textContent ?? "") === wanted)
    ?? headings.find(element => normalizeHeading(element.textContent ?? "").includes(wanted));
  if (!match) return null;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  match.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  match.dataset.talkPointed = "true";
  setTimeout(() => { delete match.dataset.talkPointed; }, 2500);
  // Linked headings end with their "#" anchor.
  return (match.textContent ?? heading).replace(/#\s*$/, "").trim();
}

/** Follow-along audio levels for the avatar. These write a CSS property straight
 * to the element, so a moving mouth never re-renders React. */
function followLevels(element: HTMLElement, microphone: MediaStream, voice: Promise<MediaStream>) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches || typeof AudioContext === "undefined") return () => {};
  const context = new AudioContext();
  void context.resume().catch(() => {});
  const meter = (stream: MediaStream) => {
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    context.createMediaStreamSource(stream).connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    return () => {
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += ((sample - 128) / 128) ** 2;
      return Math.sqrt(sum / samples.length);
    };
  };
  const reader = meter(microphone);
  let spoken: (() => number) | undefined;
  void voice.then(stream => { if (context.state !== "closed") spoken = meter(stream); }).catch(() => {});
  let level = 0;
  let frame = requestAnimationFrame(function tick() {
    const speaking = element.dataset.state === "speaking";
    const target = Math.min(1, ((speaking ? spoken?.() : reader()) ?? 0) * 4);
    level += (target - level) * 0.35;
    element.style.setProperty("--talk-level", level.toFixed(3));
    frame = requestAnimationFrame(tick);
  });
  return () => { cancelAnimationFrame(frame); void context.close().catch(() => {}); };
}

/** A voice call about the page the reader is on. While it runs, the reader
 * sees only a floating avatar: no transcript and no text chat. */
export function TalkPanel({ onClose }: { onClose: () => void }) {
  const { pathname } = useLocation();
  const [consented, setConsented] = useState(readConsent);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<PageTalkStatus>("connecting");
  const [muted, setMuted] = useState(false);
  const [ended, setEnded] = useState<Ended | null>(null);
  const [leaving, setLeaving] = useState(false);
  const avatar = useRef<HTMLSpanElement>(null);
  const transport = useRef<TalkTransport | null>(null);
  const conversation = useRef<PageConversation | null>(null);
  const live = consented && !ended;
  // open_page reads these when the voice asks, so they live in a ref.
  const navigate = useNavigate();
  const scope = useWikiScope();
  const initial = useInitialReaderData();
  const pages = useReaderQuery(readerQuery.pageIndex, initial?.pages ?? EMPTY_READER_ROWS) as PageIndexRow[];
  const reader = useRef({ navigate, scope, pages });
  useEffect(() => { reader.current = { navigate, scope, pages }; }, [navigate, scope, pages]);

  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    let stopLevels = () => {};
    let idleTimer: ReturnType<typeof setTimeout>;
    let callTimer: ReturnType<typeof setTimeout>;
    const finish = (result: Ended) => {
      if (cancelled) return;
      transport.current?.close();
      setEnded(result);
    };
    const resetIdle = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => finish({ message: "Talk ended after a few quiet minutes.", retry: true }), IDLE_LIMIT_MS);
    };

    // session.created can arrive before connectTalk resolves, so early events
    // wait here until the transport is in hand.
    const early: TalkEvent[] = [];
    const current = new PageConversation({
      send: event => { if (transport.current) transport.current.send(event); else early.push(event); },
      loadPage: loadPageMarkdown,
      pointAt: heading => pointAtHeading(heading),
      onStatus: setStatus,
      onActivity: resetIdle,
      findPage: request => findTalkPage(reader.current.pages, request, reader.current.scope),
      navigate: slug => reader.current.navigate(hrefForSlug(slug)),
      goBack: () => {
        // React Router numbers this visit's entries; 0 is where the visit began.
        if (!((window.history.state as { idx?: number } | null)?.idx)) return false;
        void reader.current.navigate(-1);
        return true;
      },
    }, talkPageForPath(window.location.pathname));
    conversation.current = current;

    // Selections on app pages (a block, a slider, a view) reach the voice as quiet notes.
    let stateTimer: ReturnType<typeof setTimeout> | undefined;
    let lastState = "";
    let unsubscribeState = () => {};
    void import("../pages/cellularity/view-state").then(({ subscribeCellularityViewState }) => {
      if (cancelled) return;
      unsubscribeState = subscribeCellularityViewState(() => {
        clearTimeout(stateTimer);
        stateTimer = setTimeout(async () => {
          const page = appTalkPage(window.location.pathname);
          const note = page ? await appTalkStateNote(page.slug) : null;
          if (note && note !== lastState) { lastState = note; current.noteState(note); }
        }, 1_200);
      });
    });

    void connectTalk({
      apiUrl: TALK_API,
      onEvent: event => current.handle(event),
      onDropped: () => finish({ message: "The call dropped. You can start it again.", retry: true }),
    }).then(connected => {
      if (cancelled) { connected.close(); return; }
      transport.current = connected;
      early.splice(0).forEach(connected.send);
      if (avatar.current) stopLevels = followLevels(avatar.current, connected.microphone, connected.voice);
      resetIdle();
      callTimer = setTimeout(() => finish({ message: "Talk ended after 30 minutes. You can start another call.", retry: true }), CALL_LIMIT_MS);
    }).catch((error: unknown) => {
      const failure = error instanceof TalkStartError ? error.failure : "network";
      finish({ message: FAILURE_MESSAGE[failure], retry: failure !== "unsupported" && failure !== "unavailable" });
    });

    const hangUp = () => transport.current?.close();
    window.addEventListener("pagehide", hangUp);
    return () => {
      cancelled = true;
      window.removeEventListener("pagehide", hangUp);
      clearTimeout(idleTimer);
      clearTimeout(callTimer);
      clearTimeout(stateTimer);
      unsubscribeState();
      stopLevels();
      current.close();
      transport.current?.close();
      transport.current = null;
      conversation.current = null;
    };
  }, [live, attempt]);

  useEffect(() => { void conversation.current?.notePage(talkPageForPath(pathname)); }, [pathname]);

  const setMicrophoneMuted = useCallback((next: boolean) => {
    transport.current?.setMuted(next);
    setMuted(next);
  }, []);

  // The launcher is gone while the panel is open; TalkHost hands focus back to it.
  if (!consented) return (
    <Dialog defaultOpen modal={false} onOpenChangeComplete={open => { if (!open) onClose(); }}>
      <DialogContent className="wiki-vite-talk-card wiki-vite-talk-consent" finalFocus="none">
        <DialogTitle>Talk with the page</DialogTitle>
        <p>Have a spoken conversation with an AI voice about the page you’re reading. It can scroll to the part it’s talking about.</p>
        <p>Your microphone audio and the text of the pages you open during the call go to OpenAI to generate replies. The conversation isn’t saved. This isn’t medical advice.</p>
        <div className="wiki-vite-talk-actions">
          <Button className="wiki-vite-talk-primary" onClick={() => { saveConsent(); setConsented(true); }}><Mic size={15} />Start talking</Button>
          <DialogClose>Not now</DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );

  if (ended) return (
    <div className="wiki-vite-talk">
      <section className="wiki-vite-talk-card" role="alert">
        <Button className="wiki-vite-talk-icon wiki-vite-talk-close" aria-label="Close" onClick={onClose}><X size={16} /></Button>
        <p>{ended.message}</p>
        {ended.retry ? (
          <div className="wiki-vite-talk-actions">
            <Button className="wiki-vite-talk-primary" onClick={() => { setEnded(null); setStatus("connecting"); setMuted(false); setAttempt(value => value + 1); }}><Mic size={15} />Talk again</Button>
          </div>
        ) : null}
      </section>
    </div>
  );

  // Hang up at once, then let the avatar shrink away before the launcher returns.
  const hangUp = () => {
    if (leaving) return;
    transport.current?.close();
    setLeaving(true);
    setTimeout(onClose, matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : LEAVE_MS);
  };

  const label = muted ? "Muted" : STATUS_LABEL[status];
  return (
    <div className="wiki-vite-talk wiki-vite-talk-live" data-talk-status={status} data-leaving={leaving} role="group" aria-label="Talk with the page" data-test-id="talk-call">
      <div className="wiki-vite-talk-stage">
        <Tooltip>
          <TooltipTrigger
            render={<Toggle
              className="wiki-vite-talk-orb"
              aria-label={muted ? "Unmute microphone" : "Mute microphone"}
              pressed={muted}
              onPressedChange={setMicrophoneMuted}
            />}
          >
            <TalkAvatar ref={avatar} state={muted ? "muted" : status} />
            <span className="wiki-vite-talk-badge" aria-hidden="true">{muted ? <MicOff size={12} /> : <Mic size={12} />}</span>
          </TooltipTrigger>
          <TooltipContent className="reader-tooltip" side="left">{label}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger render={<Button className="wiki-vite-talk-icon wiki-vite-talk-end" aria-label="End talk" onClick={hangUp} />}>
            <PhoneOff size={14} />
          </TooltipTrigger>
          <TooltipContent className="reader-tooltip">End talk</TooltipContent>
        </Tooltip>
      </div>
      <span className="wiki-vite-talk-status" role="status">{label}</span>
    </div>
  );
}
