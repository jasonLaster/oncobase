import fs from "node:fs";
import { Suspense } from "react";
import { LearningChatLoader } from "../../../components/learning-chat-loader";
export const metadata = { title: "Ask OncoGuide", description: "Explore cancer science with a learning companion grounded in OncoGuide’s lessons and cartoons." };
export default function ChatPage() {
  const { contentCommit } = JSON.parse(fs.readFileSync("public/build-info.json", "utf8"));
  return <section className="edu-learning-chat"><div className="edu-eyebrow">ASK ONCOGUIDE</div><Suspense fallback={<p role="status">Opening your learning companion…</p>}><LearningChatLoader contentCommit={contentCommit} /></Suspense></section>;
}
