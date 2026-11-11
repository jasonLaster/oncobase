"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, type ComponentProps } from "react";
import { SessionChat } from "@oncobase/chat/components/session-chat";
import { StreamingMarkdown } from "@oncobase/chat/components/streaming-markdown";
import type { ChatMarkdownRendererProps } from "@oncobase/chat/types";
import { AudioLines } from "lucide-react";
import { ImageTheater } from "@oncobase/wiki-markdown/image-theater";
import { requestTalk, useTalkState } from "../lib/talk-store";
import { TalkBoard } from "./talk-board";
import { AnswerResources, AnswerText } from "./chat-resources";

function EducationCitation({ href, children }: ComponentProps<"a">) {
  return href?.startsWith("/education/") ? <Link href={href}>{children}</Link> : <span>{children}</span>;
}
function EducationMarkdown(props: ChatMarkdownRendererProps) { return <StreamingMarkdown {...props} LinkComponent={EducationCitation} />; }
export function LearningChat({ contentCommit }: { contentCommit: string }) {
  const params = useSearchParams();
  const currentSlug = params.get("lesson") ?? undefined;
  const body = useMemo(() => ({ currentSlug, contentCommit }), [currentSlug, contentCommit]);
  const { live, cards } = useTalkState();
  const showBoard = live || cards.length > 0;
  // Typed chat stays mounted under the board so returning restores it untouched.
  return <>{showBoard ? <TalkBoard /> : null}<div className="edu-chat-typed" hidden={showBoard}><SessionChat
    composerAction={<button type="button" className="edu-chat-talk" onClick={requestTalk}><AudioLines size={16} aria-hidden="true" />Talk<span className="edu-chat-talk-label"> with OncoGuide</span></button>}
    apiPath={process.env.NEXT_PUBLIC_ONCOGUIDE_CHAT_API || (["localhost", "127.0.0.1"].includes(window.location.hostname) ? "/api/education/chat" : "https://diana-tnbc.com/api/education/chat")}
    body={body} initialQuestion={params.get("q") ?? undefined} storageKey="oncoguide:learning-chat"
    MarkdownRenderer={EducationMarkdown}
    assistantName="OncoGuide" footnote="Learn the science at your pace. For personal care decisions, talk with your care team."
    title="Follow your curiosity."
    description="Ask a question. Find an explanation, the lesson’s own pictures, and a path into the lessons."
    suggestions={["How does the immune system recognize cancer?", "What can a ctDNA test tell us?", "Explain DNA repair with a cartoon", "How do cancer vaccines work?"]}
    renderText={(message, text, isStreaming, actions) => <AnswerText message={message} text={text} isStreaming={isStreaming} actions={actions} render={(content, streaming) => <EducationMarkdown content={content} isStreaming={streaming} />} />}
    renderData={(message, actions) => <AnswerResources message={message} actions={actions} />}
  /><ImageTheater scopeSelector=".session-chat" /></div></>;
}
