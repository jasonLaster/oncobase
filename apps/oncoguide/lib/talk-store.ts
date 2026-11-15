import { useSyncExternalStore } from "react";
import { boardTopicId, mergeBoardCards } from "./board-topics";

/** State shared by the call, which lives in the root layout, and the chat page.
 * Kept small and free of the library, because it is in the initial bundle. */
export type BoardSource = { sectionId: string; href: string; pageTitle: string };
export type BoardCard = { id: string; source: BoardSource } & (
  | { kind: "image"; src: string; darkSrc?: string; alt: string; caption: string }
  | { kind: "diagram" | "table"; fragment: string; caption: string }
  | { kind: "key_points"; title: string; points: string[] }
  | { kind: "steps"; title: string; steps: string[] }
  | { kind: "comparison"; title: string; columns: string[]; rows: string[][] }
  | { kind: "lesson"; title: string; heading: string | null }
);
type TalkState = { activeTopic: string | null; latestTopic: string | null; following: boolean; live: boolean; cards: BoardCard[]; openRequests: number; asked: { card: BoardCard; count: number } | null };

let state: TalkState = { activeTopic: null, latestTopic: null, following: true, live: false, cards: [], openRequests: 0, asked: null };
const listeners = new Set<() => void>();
const set = (change: Partial<TalkState>) => {
  state = { ...state, ...change };
  listeners.forEach(listener => listener());
};
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const snapshot = () => state;

export const useTalkState = () => useSyncExternalStore(subscribe, snapshot, snapshot);
export const requestTalk = () => set({ openRequests: state.openRequests + 1 });
export const setTalkLive = (live: boolean) => { if (state.live !== live) set({ live }); };
export const addBoardCards = (cards: BoardCard[]) => {
  if (!cards.length) return;
  const latestTopic = boardTopicId(cards[cards.length - 1]!);
  const merged = mergeBoardCards(state.cards, cards);
  const activeExists = merged.some(card => boardTopicId(card) === state.activeTopic);
  set({ cards: merged, latestTopic, activeTopic: state.following || !activeExists ? latestTopic : state.activeTopic });
};
/** A tap on a board card during a call: the voice explains it. */
export const askAboutCard = (card: BoardCard) => set({ asked: { card, count: (state.asked?.count ?? 0) + 1 } });
export const clearBoard = () => set({ cards: [], activeTopic: null, latestTopic: null, following: true, asked: null });
export const selectBoardTopic = (activeTopic: string) => set({ activeTopic, following: false });
export const followBoard = () => set({ activeTopic: state.latestTopic, following: true });
export const boardCardsSnapshot = () => state.cards;
export const boardCardIds = () => new Set(state.cards.map(card => card.id));
