"use client";
import dynamic from "next/dynamic";
const LearningChat = dynamic(() => import("./learning-chat").then(module => module.LearningChat), {
  ssr: false, loading: () => <p role="status">Opening your learning companion…</p>,
});
export function LearningChatLoader({ contentCommit }: { contentCommit: string }) { return <LearningChat contentCommit={contentCommit} />; }
