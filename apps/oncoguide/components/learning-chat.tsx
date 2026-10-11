"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, type ComponentProps } from "react";
import { SessionChat } from "@oncobase/chat/components/session-chat";
import { StreamingMarkdown } from "@oncobase/chat/components/streaming-markdown";
import type { ChatMarkdownRendererProps } from "@oncobase/chat/types";
import type { EducationReference, EducationSection } from "@oncobase/education/chat";
import { BookOpen, ArrowUpRight } from "lucide-react";
import { ImageTheater } from "@oncobase/wiki-markdown/image-theater";

type Resources = { sections: EducationReference[]; illustrations: Array<EducationSection["images"][number] & { href: string; pageTitle: string }> };
function EducationCitation({ href, children }: ComponentProps<"a">) {
  return href?.startsWith("/education/") ? <Link href={href}>{children}</Link> : <span>{children}</span>;
}
function EducationMarkdown(props: ChatMarkdownRendererProps) { return <StreamingMarkdown {...props} LinkComponent={EducationCitation} />; }
export function LearningChat({ contentCommit }: { contentCommit: string }) {
  const params = useSearchParams();
  const currentSlug = params.get("lesson") ?? undefined;
  const body = useMemo(() => ({ currentSlug, contentCommit }), [currentSlug, contentCommit]);
  return <><SessionChat
    apiPath={process.env.NEXT_PUBLIC_ONCOGUIDE_CHAT_API || (["localhost", "127.0.0.1"].includes(window.location.hostname) ? "/api/education/chat" : "https://diana-tnbc.com/api/education/chat")}
    body={body} initialQuestion={params.get("q") ?? undefined} storageKey="oncoguide:learning-chat"
    MarkdownRenderer={EducationMarkdown}
    assistantName="OncoGuide" footnote="Learn the science at your pace. For personal care decisions, talk with your care team."
    title="Follow your curiosity."
    description="Ask a question. Find an explanation, a helpful cartoon, and a path into the lessons."
    suggestions={["How does the immune system recognize cancer?", "What can a ctDNA test tell us?", "Explain DNA repair with a cartoon", "How do cancer vaccines work?"]}
    renderData={message => {
      const part = message.parts.find(part => part.type === "data-education");
      if (!part || !("data" in part)) return null;
      const resources = part.data as Resources;
      if (!resources.sections?.length) return null;
      return <div className="edu-chat-resources">
        <div className="edu-chat-resource-label"><BookOpen size={14} aria-hidden="true" />Explore these sections</div>
        <div className="edu-chat-section-grid">{resources.sections.map(section => <Link key={section.id} href={section.href} className="edu-chat-section-card">
          <span>{section.pageTitle}</span><h3>{section.heading === "Start here" ? section.pageTitle : section.heading}<ArrowUpRight size={15} aria-hidden="true" /></h3><p>{section.excerpt}{section.excerpt.length === 240 ? "…" : ""}</p>
        </Link>)}</div>
        {resources.illustrations?.length > 0 && <><div className="edu-chat-resource-label">A visual way in</div><div className="edu-chat-illustrations">{resources.illustrations.map(image => <figure key={image.src} className="edu-chat-illustration">
          <div>{image.darkSrc ? <><img src={image.src} alt={image.alt} loading="lazy" className="dark:hidden" data-theater-image role="button" tabIndex={0} aria-label={`Enlarge: ${image.alt}`} /><img src={image.darkSrc} alt={image.alt} loading="lazy" className="hidden dark:block" data-theater-image role="button" tabIndex={0} aria-label={`Enlarge: ${image.alt}`} /></> : <img src={image.src} alt={image.alt} loading="lazy" data-theater-image role="button" tabIndex={0} aria-label={`Enlarge: ${image.alt}`} />}</div><Link href={image.href}>{image.alt}<ArrowUpRight size={14} aria-hidden="true" /></Link>
        </figure>)}</div></>}
      </div>;
    }}
  /><ImageTheater scopeSelector=".session-chat" /></>;
}
