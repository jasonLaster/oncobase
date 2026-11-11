import { useSyncExternalStore } from "react";

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
type TalkState = { live: boolean; cards: BoardCard[]; openRequests: number; asked: { card: BoardCard; count: number } | null };

const MAX_CARDS = 40;
let state: TalkState = { live: false, cards: [], openRequests: 0, asked: null };
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
  const known = new Set(state.cards.map(card => card.id));
  const added = cards.filter(card => !known.has(card.id));
  if (added.length) set({ cards: [...state.cards, ...added].slice(-MAX_CARDS) });
};
/** A tap on a board card during a call: the voice explains it. */
export const askAboutCard = (card: BoardCard) => set({ asked: { card, count: (state.asked?.count ?? 0) + 1 } });
export const clearBoard = () => set({ cards: [] });
export const boardCardIds = () => new Set(state.cards.map(card => card.id));
