import type { BoardCard } from "./talk-store";
export const boardTopicId = (card: BoardCard) => card.source.href.split("#")[0]!.replace(/\/$/, "");
export const isBoardVisual = (card: BoardCard) => ["image", "diagram", "table"].includes(card.kind);
const slot = (card: BoardCard) => `${boardTopicId(card)}:${isBoardVisual(card) ? "visual" : card.kind === "lesson" ? "lesson" : "context"}`;
/** A topic keeps one source visual and one evolving explanation. */
export function mergeBoardCards(previous: BoardCard[], incoming: BoardCard[]): BoardCard[] {
  const merged = [...previous];
  for (const card of incoming) {
    const index = merged.findIndex(existing => slot(existing) === slot(card));
    if (index < 0) merged.push(card); else merged[index] = card;
  }
  return merged.slice(-40);
}
export function boardTopics(cards: BoardCard[]) {
  const topics = new Map<string, { id: string; title: string; cards: BoardCard[] }>();
  for (const card of cards) {
    const id = boardTopicId(card);
    const topic = topics.get(id) ?? { id, title: card.source.pageTitle, cards: [] };
    topic.cards.push(card); topics.set(id, topic);
  }
  return [...topics.values()];
}
export function describeBoardCard(card: BoardCard): string {
  return JSON.stringify({ source: card.source.sectionId, kind: card.kind, content:
    "points" in card ? card.points : "steps" in card ? card.steps : "rows" in card ? { columns: card.columns, rows: card.rows } : "caption" in card ? card.caption : card.title,
  }).slice(0, 1400);
}
