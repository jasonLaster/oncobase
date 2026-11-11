"use client";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { ArrowUpRight, BookOpen, Mic } from "lucide-react";
import { ImageTheater } from "@oncobase/wiki-markdown/image-theater";
import { askAboutCard, clearBoard, requestTalk, useTalkState, type BoardCard } from "../lib/talk-store";
import { LessonVisual, VisualZoom, type ShownVisual } from "./lesson-visual";

function Source({ card, written }: { card: BoardCard; written?: boolean }) {
  return <p className="edu-talk-board-source">
    {written ? <span>AI summary of </span> : null}
    <Link href={card.source.href}>{card.source.pageTitle}<ArrowUpRight size={13} aria-hidden="true" /></Link>
  </p>;
}

function Card({ card, live }: { card: BoardCard; live: boolean }) {
  switch (card.kind) {
    case "image":
    case "diagram":
    case "table": {
      const visual: ShownVisual = card.kind === "image" ? { kind: "cartoon", alt: card.alt, src: card.src, darkSrc: card.darkSrc } : { kind: card.kind, alt: card.caption, fragment: card.fragment };
      return <figure className="edu-talk-board-card edu-talk-board-figure" data-card-kind={card.kind}>
        <LessonVisual visual={visual} />
        <figcaption>{card.caption}</figcaption>
        <div className="edu-talk-board-foot">
          <Source card={card} />
          <span className="edu-chat-visual-actions">
            <VisualZoom visual={visual} title={card.caption} />
            {live ? <button type="button" className="edu-visual-action" onClick={() => askAboutCard(card)}><Mic size={13} aria-hidden="true" />Ask about this</button> : null}
          </span>
        </div>
      </figure>;
    }
    case "key_points":
      return <article className="edu-talk-board-card" data-card-kind="key_points">
        <h2>{card.title}</h2>
        <ul>{card.points.map(point => <li key={point}>{point}</li>)}</ul>
        <Source card={card} written />
      </article>;
    case "steps":
      return <article className="edu-talk-board-card" data-card-kind="steps">
        <h2>{card.title}</h2>
        <ol className="edu-talk-board-steps">{card.steps.map(step => <li key={step}><span>{step}</span></li>)}</ol>
        <Source card={card} written />
      </article>;
    case "comparison":
      return <article className="edu-talk-board-card" data-card-kind="comparison">
        <h2>{card.title}</h2>
        <div className="edu-talk-board-table"><table>
          <thead><tr>{card.columns.map(column => <th key={column} scope="col">{column}</th>)}</tr></thead>
          <tbody>{card.rows.map(row => <tr key={row.join("|")}>{row.map((cell, index) => <td key={`${index}:${cell}`}>{cell}</td>)}</tr>)}</tbody>
        </table></div>
        <Source card={card} written />
      </article>;
    case "lesson":
      return <Link href={card.source.href} className="edu-talk-board-card edu-talk-board-lesson" data-card-kind="lesson">
        <BookOpen size={17} aria-hidden="true" />
        <span><strong>{card.title}</strong>{card.heading ? <small>{card.heading}</small> : null}</span>
        <ArrowUpRight size={15} aria-hidden="true" />
      </Link>;
  }
}

/** Fills as the reader talks. There is deliberately no transcript here: the
 * board shows what makes the conversation easier to follow, not what was said. */
export function TalkBoard() {
  const { live, cards } = useTalkState();
  const feed = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  useEffect(() => {
    const element = feed.current;
    const newest = element?.lastElementChild as HTMLElement | null | undefined;
    // Align the card's top, since a diagram can be taller than the feed.
    if (element && newest && pinned.current) element.scrollTo({ top: newest.offsetTop - element.offsetTop - 12, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [cards.length]);
  return <section className="edu-talk-board" aria-label="Conversation board">
    <header className="edu-talk-board-header" data-compact={cards.length > 0 || undefined}>
      <div>
        <h1>{live ? "Talk it through." : "Your conversation"}</h1>
        <p>{live ? "Cartoons, diagrams and key points appear here as you talk." : "This board stays until you leave this tab or go back to typing."}</p>
      </div>
      {live ? null : <div className="edu-talk-board-actions">
        <button type="button" className="edu-talk-board-primary" onClick={requestTalk}><Mic size={15} aria-hidden="true" />Talk again</button>
        <button type="button" onClick={clearBoard}>Back to typing</button>
      </div>}
    </header>
    <div ref={feed} className="edu-talk-board-feed" role="log" aria-live="polite" aria-relevant="additions" tabIndex={0} aria-label="Visuals from your conversation"
      onScroll={event => { const element = event.currentTarget; pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 120; }}>
      {cards.length ? cards.map(card => <Card key={card.id} card={card} live={live} />) : <div className="edu-talk-board-empty">
        <p>Ask about anything in the lessons. For example:</p>
        <ul><li>What does an antibody-drug conjugate do?</li><li>How does the immune system recognize cancer?</li><li>What can a ctDNA test tell us?</li></ul>
      </div>}
    </div>
    <ImageTheater scopeSelector=".edu-talk-board" />
  </section>;
}
