import { useSyncExternalStore } from "react";

/** Whether "Talk with the page" is open, shared by the desktop launcher, the
 * mobile button group and the call itself. Tiny, because it is in the initial
 * bundle; the call code loads only when a reader opens it. */
type TalkState = { open: boolean };

let state: TalkState = { open: false };
const listeners = new Set<() => void>();
const set = (change: Partial<TalkState>) => {
  state = { ...state, ...change };
  listeners.forEach(listener => listener());
};
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const snapshot = () => state;

export const useTalkState = () => useSyncExternalStore(subscribe, snapshot, snapshot);
export const openTalk = () => { if (!state.open) set({ open: true }); };
export const closeTalk = () => { if (state.open) set({ open: false }); };
export const loadTalkPanel = () => import("./TalkPanel");
