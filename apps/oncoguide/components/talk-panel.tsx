"use client";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Captions, LayoutGrid, Mic, MicOff, PhoneOff, X } from "lucide-react";
import { EducationCorpusSchema, type EducationCorpus } from "@oncobase/education/chat";
import { normalizeEducationPath, TALK_BOARD_PATH } from "@oncobase/education/talk";
import type { TalkVisual } from "@oncobase/education/talk-visuals";
import { addBoardCards, boardCardIds, setTalkLive, useTalkState } from "../lib/talk-store";
import { TalkConversation, type TalkStatus, type TalkView } from "../lib/talk-conversation";
import { connectTalk, TalkStartError, type TalkEvent, type TalkFailure, type TalkTransport } from "../lib/talk-transport";
import { TalkAvatar } from "./talk-avatar";

const CONSENT_KEY = "oncoguide:talk-consent";
const IDLE_LIMIT_MS = 5 * 60_000;
const CALL_LIMIT_MS = 30 * 60_000;
const talkApiUrl = () => process.env.NEXT_PUBLIC_ONCOGUIDE_TALK_API || (["localhost", "127.0.0.1"].includes(window.location.hostname) ? "/api/education/talk" : "https://diana-tnbc.com/api/education/talk");
const STATUS_LABEL: Record<TalkStatus, string> = { connecting: "Connecting…", listening: "Listening", hearing: "Listening", thinking: "Thinking…", searching: "Checking lessons…", speaking: "Speaking" };
const FAILURE_MESSAGE: Record<TalkFailure, string> = {
  unsupported: "This browser can’t make voice calls. Try a recent version of Chrome, Safari, Edge or Firefox.",
  "mic-denied": "OncoGuide needs your microphone to talk. Allow it in your browser’s site settings, then try again.",
  "no-mic": "No microphone was found. Connect one, then try again.",
  busy: "Talk is busy right now. Please try again in a few minutes.",
  unavailable: "Talk isn’t available right now.",
  network: "Talk couldn’t connect. Check your connection and try again.",
};
type Ended = { message: string; retry: boolean };
const CHAT_STORAGE_KEY = "oncoguide:learning-chat";
/** The last typed turns, so a call started from chat can pick up where it left off. */
function typedHistory() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(CHAT_STORAGE_KEY) ?? "null") as { messages?: Array<{ role: string; parts: Array<{ type: string; text?: string }> }> } | null;
    return (saved?.messages ?? []).slice(-6).map(message => {
      const text = message.parts.filter(part => part.type === "text").map(part => part.text ?? "").join(" ").slice(0, 500);
      return text ? `${message.role === "user" ? "Reader" : "OncoGuide"}: ${text}` : "";
    }).filter(Boolean).join("\n");
  } catch { return ""; }
}
const readConsent = () => { try { return localStorage.getItem(CONSENT_KEY) === "1"; } catch { return false; } };
const saveConsent = () => { try { localStorage.setItem(CONSENT_KEY, "1"); } catch { /* Ask again next time. */ } };

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

export function TalkPanel({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const [consented, setConsented] = useState(readConsent);
  const [attempt, setAttempt] = useState(0);
  const [view, setView] = useState<TalkView | null>(null);
  const [muted, setMuted] = useState(false);
  const [ended, setEnded] = useState<Ended | null>(null);
  const [captionsOnBoard, setCaptionsOnBoard] = useState(false);
  const { cards } = useTalkState();
  const onBoardPage = normalizeEducationPath(pathname) === TALK_BOARD_PATH;
  const avatar = useRef<HTMLSpanElement>(null);
  const transport = useRef<TalkTransport | null>(null);
  const conversation = useRef<TalkConversation | null>(null);
  const live = consented && !ended;

  useEffect(() => {
    setTalkLive(live);
    return () => setTalkLive(false);
  }, [live]);

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

    let corpus: Promise<EducationCorpus> | undefined;
    const loadCorpus = () => {
      corpus ??= fetch("/chat-index.json").then(async response => {
        if (!response.ok) throw Error("Library unavailable");
        return EducationCorpusSchema.parse(await response.json());
      }).catch(error => { corpus = undefined; throw error; });
      return corpus;
    };
    void loadCorpus().catch(() => {});
    let visuals: Promise<TalkVisual[]> | undefined;
    const loadVisuals = () => {
      visuals ??= fetch("/talk-visuals.json").then(async response => {
        if (!response.ok) throw Error("Visuals unavailable");
        return await response.json() as TalkVisual[];
      }).catch(error => { visuals = undefined; throw error; });
      return visuals;
    };

    // session.created can arrive before connectTalk resolves, so early events
    // from the conversation wait here until the transport is in hand.
    const early: TalkEvent[] = [];
    const current = new TalkConversation({
      send: event => { if (transport.current) transport.current.send(event); else early.push(event); },
      navigate: href => router.push(href),
      corpus: loadCorpus,
      onChange: setView,
      onActivity: resetIdle,
      visuals: loadVisuals,
      onBoardCards: addBoardCards,
      boardCardIds,
      typedHistory,
    }, window.location.pathname);
    conversation.current = current;
    setView({ status: "connecting", readerCaption: "", voiceCaption: "", suggestion: null });
    setMuted(false);

    void connectTalk({
      apiUrl: talkApiUrl(),
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
      stopLevels();
      current.close();
      transport.current?.close();
      transport.current = null;
      conversation.current = null;
    };
  }, [live, attempt, router]);

  useEffect(() => { void conversation.current?.notePage(pathname); }, [pathname]);

  // Lesson links already route on the client, but header search is a plain form.
  // A full page load would hang up, so keep search on the client during a call.
  useEffect(() => {
    if (!live) return;
    const onSubmit = (event: SubmitEvent) => {
      const form = event.target as HTMLFormElement;
      if (event.defaultPrevented || !form.classList.contains("edu-search")) return;
      event.preventDefault();
      router.push(`/education/search/?q=${encodeURIComponent(String(new FormData(form).get("q") ?? ""))}`);
    };
    document.addEventListener("submit", onSubmit);
    return () => document.removeEventListener("submit", onSubmit);
  }, [live, router]);

  const toggleMute = useCallback(() => setMuted(value => {
    transport.current?.setMuted(!value);
    return !value;
  }), []);

  if (!consented) return <div className="edu-talk">
    <section className="edu-talk-card" role="dialog" aria-label="Talk with OncoGuide" onKeyDown={event => { if (event.key === "Escape") onClose(); }}>
      <h2>Talk with OncoGuide</h2>
      <p>Have a spoken conversation about the lessons with an AI voice. It can offer to open the pages you’re discussing.</p>
      <p>Your microphone audio goes to OpenAI to generate replies, along with your typed messages if you start from chat. OncoGuide doesn’t save your conversation. This is for learning, not medical advice.</p>
      <div className="edu-talk-actions">
        <button type="button" className="edu-talk-primary" autoFocus onClick={() => { saveConsent(); setConsented(true); }}><Mic size={15} aria-hidden="true" />Start talking</button>
        <button type="button" onClick={onClose}>Not now</button>
      </div>
    </section>
  </div>;

  if (ended) return <div className="edu-talk">
    <section className="edu-talk-card" role="alert">
      <button type="button" className="edu-talk-icon edu-talk-close" aria-label="Close" onClick={onClose}><X size={16} aria-hidden="true" /></button>
      <p>{ended.message}</p>
      {ended.retry ? <div className="edu-talk-actions"><button type="button" className="edu-talk-primary" onClick={() => { setEnded(null); setAttempt(value => value + 1); }}><Mic size={15} aria-hidden="true" />Talk again</button></div> : null}
    </section>
  </div>;

  const status = view?.status ?? "connecting";
  const suggestion = view?.suggestion;
  // The board replaces the transcript, so captions there are opt-in.
  const caption = onBoardPage && !captionsOnBoard ? "" : view?.voiceCaption || view?.readerCaption;
  return <div className="edu-talk" data-talk-status={status}>
    {suggestion ? <section className="edu-talk-card edu-talk-suggestion" role="status" aria-label="Suggested page">
      <span className="edu-talk-eyebrow">Open this page?</span>
      <strong>{suggestion.pageTitle}</strong>
      {suggestion.heading ? <span className="edu-talk-page">{suggestion.heading}</span> : null}
      {suggestion.reason ? <p>{suggestion.reason}</p> : null}
      <div className="edu-talk-actions">
        <button type="button" className="edu-talk-primary" onClick={() => conversation.current?.acceptSuggestion()}>Yes, open it<ArrowRight size={15} aria-hidden="true" /></button>
        <button type="button" onClick={() => conversation.current?.dismissSuggestion()}>Not now</button>
      </div>
    </section> : null}
    {caption ? <p className={`edu-talk-caption${view?.voiceCaption ? "" : " edu-talk-caption-reader"}`} data-test-id="talk-caption">{caption}</p> : null}
    <div className="edu-talk-dock" role="group" aria-label="Talk with OncoGuide">
      <TalkAvatar ref={avatar} state={muted ? "muted" : status} />
      <span className="edu-talk-status">
        <strong role="status">{muted ? "Muted" : STATUS_LABEL[status]}</strong>
        <small>AI voice · OncoGuide</small>
      </span>
      {onBoardPage
        ? <button type="button" className="edu-talk-icon" aria-label="Show captions" aria-pressed={captionsOnBoard} onClick={() => setCaptionsOnBoard(value => !value)}><Captions size={17} aria-hidden="true" /></button>
        : cards.length ? <button type="button" className="edu-talk-icon" aria-label="Back to board" onClick={() => router.push(TALK_BOARD_PATH)}><LayoutGrid size={17} aria-hidden="true" /></button> : null}
      <button type="button" className="edu-talk-icon" aria-label={muted ? "Unmute microphone" : "Mute microphone"} aria-pressed={muted} onClick={toggleMute}>{muted ? <MicOff size={17} aria-hidden="true" /> : <Mic size={17} aria-hidden="true" />}</button>
      <button type="button" className="edu-talk-icon edu-talk-end" aria-label="End talk" onClick={onClose}><PhoneOff size={17} aria-hidden="true" /></button>
    </div>
  </div>;
}
