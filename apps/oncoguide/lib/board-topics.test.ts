import { expect, test } from "bun:test";
import { boardTopics, describeBoardCard, mergeBoardCards } from "./board-topics";
import type { BoardCard } from "./talk-store";
const source = { sectionId: "/education/receptor/#parts", href: "/education/receptor/#parts", pageTitle: "Receptor" };
const image: BoardCard = { id: "image", kind: "image", src: "/image.png", alt: "Receptor", caption: "Parts", source };
const summary: BoardCard = { id: "summary", kind: "key_points", title: "Basics", points: ["First explanation"], source };
test("follow-ups replace context while preserving the visual and other topics", () => {
  const other: BoardCard = { ...image, id: "other", source: { ...source, href: "/education/cell/", pageTitle: "Cell" } };
  const next: BoardCard = { id: "new-title", kind: "steps", title: "Process", steps: ["Bind", "Signal"], source };
  const cards = mergeBoardCards([image, summary, other], [next, image]);
  expect(cards.map(card => card.id)).toEqual(["image", "new-title", "other"]);
  expect(boardTopics(cards).map(topic => topic.title)).toEqual(["Receptor", "Cell"]);
  expect(describeBoardCard(next)).toContain('"content":["Bind","Signal"]');
});
