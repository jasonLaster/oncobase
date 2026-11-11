"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import type { UIMessage } from "ai";
import { ArrowUpRight, BookOpen, MessageCircleQuestion } from "lucide-react";
import type { SessionChatActions } from "@oncobase/chat/components/session-chat";
import type { EducationReference, EducationSection } from "@oncobase/education/chat";
import type { FollowUp, LessonCard } from "@oncobase/education/tutor";
import type { EducationVisual } from "@oncobase/education/visuals";
import { LessonVisual, VisualZoom } from "./lesson-visual";

type ShownEducationVisual = Omit<EducationVisual, "brief"> & { marker?: string };
/** What the tutor sends beside its words. `visuals` are its own choices from
 * the catalog, placed in the text by their markers. `illustrations` is what a
 * server without the catalog sends: cartoons found by lesson search. */
type Resources = {
  sections: EducationReference[]; visuals?: ShownEducationVisual[]; lessons?: LessonCard[]; followUps?: FollowUp[];
  illustrations: Array<EducationSection["images"][number] & { href: string; pageTitle: string }>;
};
const MARKER = /(\[\[visual:\d+\]\])/;
const NOUN = { cartoon: "picture", diagram: "diagram", table: "table" } as const;

function resourcesOf(message: UIMessage): Resources | null {
  const part = message.parts.find(part => part.type === "data-education");
  return part && "data" in part ? part.data as Resources : null;
}
const answerText = (message: UIMessage) => message.parts.map(part => part.type === "text" ? part.text : "").join("\n");

function ChatVisual({ visual, actions }: { visual: ShownEducationVisual; actions: SessionChatActions }) {
  const caption = visual.caption || (visual.kind === "cartoon" ? visual.label : visual.heading);
  const shown = { kind: visual.kind, alt: visual.label, src: visual.src, darkSrc: visual.darkSrc, fragment: visual.fragment };
  return <figure className="edu-chat-visual" data-visual-kind={visual.kind} data-visual-id={visual.id}>
    <LessonVisual visual={shown} />
    <figcaption>{caption}</figcaption>
    <div className="edu-chat-visual-foot">
      <Link href={visual.href}>{visual.pageTitle}<ArrowUpRight size={14} aria-hidden="true" /></Link>
      <span className="edu-chat-visual-actions">
        <VisualZoom visual={shown} title={caption} />
        <button type="button" className="edu-visual-action" disabled={actions.busy} onClick={() => actions.ask(`Walk me through this ${NOUN[visual.kind]} from “${visual.pageTitle}”.`, { focusVisual: visual.id, focusMode: "explain" })}><MessageCircleQuestion size={13} aria-hidden="true" />Explain this</button>
      </span>
    </div>
  </figure>;
}

/** The tutor's words, with each visual it chose placed where it pointed. */
export function AnswerText({ message, text, isStreaming, actions, render }: {
  message: UIMessage; text: string; isStreaming: boolean; actions: SessionChatActions; render: (content: string, isStreaming: boolean) => ReactNode;
}) {
  const visuals = resourcesOf(message)?.visuals ?? [];
  // A marker still arriving is not shown as stray brackets.
  const pieces = (isStreaming ? text.replace(/\[\[?[a-z]*:?\d*\]?$/, "") : text).split(MARKER);
  const placed = new Set<string>();
  return <>{pieces.map((piece, index) => {
    if (!MARKER.test(piece)) return piece.trim() ? <div key={index}>{render(piece, isStreaming && index === pieces.length - 1)}</div> : null;
    const visual = visuals.find(candidate => candidate.marker === piece);
    if (!visual || placed.has(visual.id)) return null;
    placed.add(visual.id);
    return <ChatVisual key={index} visual={visual} actions={actions} />;
  })}</>;
}

function LessonAbout({ lesson }: { lesson: LessonCard }) {
  const links = (label: string, items: LessonCard["learnFirst"]) => items.length ? <p className="edu-chat-lesson-links"><span>{label}</span>{items.map(item => <Link key={item.href} href={item.href}>{item.title}</Link>)}</p> : null;
  return <aside className="edu-chat-lesson" aria-label={`About ${lesson.title}`}>
    <div className="edu-chat-lesson-head"><Link href={lesson.href}>{lesson.title}<ArrowUpRight size={14} aria-hidden="true" /></Link>{lesson.level ? <span className="edu-chat-level" data-level={lesson.level}>{lesson.level}</span> : null}</div>
    {lesson.path ? <p className="edu-chat-path">Step {lesson.path.step} of {lesson.path.of}{lesson.path.minutes ? ` · ${lesson.path.minutes} min` : ""} in <Link href={lesson.path.guideHref}>{lesson.path.guide}</Link>{lesson.path.next ? <> · Next: <Link href={lesson.path.next.href}>{lesson.path.next.title}</Link></> : null}</p> : null}
    {lesson.summary ? <p className="edu-chat-lesson-summary">{lesson.summary}</p> : null}
    {links("Learn first", lesson.learnFirst)}
    {links("Used in", lesson.usedIn)}
  </aside>;
}

/** Cards under an answer: about the lesson, any visual the tutor did not
 * place, the sections it drew on, and next steps. */
export function AnswerResources({ message, actions }: { message: UIMessage; actions: SessionChatActions }) {
  const resources = resourcesOf(message);
  if (!resources?.sections?.length) return null;
  const text = answerText(message);
  const unplaced = (resources.visuals ?? []).filter(visual => !visual.marker || !text.includes(visual.marker)).slice(0, 2);
  return <div className="edu-chat-resources">
    {unplaced.length ? <><div className="edu-chat-resource-label">A visual way in</div><div className="edu-chat-visuals">{unplaced.map(visual => <ChatVisual key={visual.id} visual={visual} actions={actions} />)}</div></> : null}
    {resources.lessons?.map(lesson => <LessonAbout key={lesson.slug} lesson={lesson} />)}
    <div className="edu-chat-resource-label"><BookOpen size={14} aria-hidden="true" />Explore these sections</div>
    <div className="edu-chat-section-grid">{resources.sections.map(section => <Link key={section.id} href={section.href} className="edu-chat-section-card">
      <span>{section.pageTitle}</span><h3>{section.heading === "Start here" ? section.pageTitle : section.heading}<ArrowUpRight size={15} aria-hidden="true" /></h3><p>{section.excerpt}{section.excerpt.length === 240 ? "…" : ""}</p>
    </Link>)}</div>
    {!resources.visuals && resources.illustrations?.length > 0 && <><div className="edu-chat-resource-label">A visual way in</div><div className="edu-chat-illustrations">{resources.illustrations.map(image => <figure key={image.src} className="edu-chat-illustration">
      <div><LessonVisual visual={{ kind: "cartoon", alt: image.alt, src: image.src, darkSrc: image.darkSrc }} /></div>
      <Link href={image.href}><span>{image.alt}</span><ArrowUpRight size={14} aria-hidden="true" /></Link>
    </figure>)}</div></>}
    {actions.latest && !actions.busy && resources.followUps?.length ? <div className="edu-chat-followups" role="group" aria-label="Next steps">{resources.followUps.map(step => <button type="button" key={step.label} onClick={() => actions.ask(step.question,
      step.visualId ? { focusVisual: step.visualId, focusMode: step.mode ?? "explain" } : undefined,
      step.visualId && step.mode === "quiz" ? { focusVisual: step.visualId, focusMode: "check" } : undefined)}>{step.label}</button>)}</div> : null}
  </div>;
}
