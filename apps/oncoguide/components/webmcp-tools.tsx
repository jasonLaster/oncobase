"use client";
import { useRouter } from "next/navigation";
import { EducationCorpusSchema, type EducationCorpus } from "@oncobase/education/chat";
import { normalizeEducationPath, TALK_BOARD_PATH } from "@oncobase/education/talk";
import {
  educationLessonAtPath, educationLessonSections, readEducationSection, resolveEducationTarget,
  searchEducationSections, selectedPageText, visibleHeading,
} from "@oncobase/education/webmcp";
import {
  findPassageElement, highlightElement, useWebMcpTools, waitForElement, webMcpError, type WebMcpTool,
} from "@oncobase/wiki-shell/webmcp";
import { educationHref } from "../lib/routes";

/** WebMCP tools for OncoGuide: an in-browser agent can search, read and walk
 * the public lessons the same way Talk does, over the same /chat-index.json.
 * Mounted once in the frame, so registration survives client navigation. */

type Topic = { key: string; title: string; pages: Array<{ slug: string; title: string }> };

let corpusPromise: Promise<EducationCorpus> | undefined;
const loadCorpus = () => {
  corpusPromise ??= fetch("/chat-index.json").then(async response => {
    if (!response.ok) throw Error("The lesson library is unavailable right now.");
    return EducationCorpusSchema.parse(await response.json());
  }).catch(error => { corpusPromise = undefined; throw error; });
  return corpusPromise;
};

const str = (input: Record<string, unknown>, key: string) => typeof input[key] === "string" ? (input[key] as string).trim() : "";
const currentPath = () => normalizeEducationPath(window.location.pathname);
const article = () => document.querySelector<HTMLElement>('[data-test-id="education-article"]');
const mainRoot = () => document.getElementById("education-main");
const sectionId = { type: "string", description: "A section id exactly as returned by search_education or lesson_sections." };
const lessonSlug = { type: "string", description: "A lesson slug from list_lessons or search_education, such as \"wiki/education/oncology-101/index\"." };

/** Navigate to an education href and resolve once the new page is rendered. */
async function goTo(push: (href: string) => void, href: string, signal?: AbortSignal) {
  const target = normalizeEducationPath(href);
  const id = decodeURIComponent(href.split("#")[1] ?? "");
  if (currentPath() !== target) push(href);
  const ready = await waitForElement(() => currentPath() === target && (target === TALK_BOARD_PATH || article()) ? true : null, { timeoutMs: 8000, signal });
  if (!ready) return false;
  if (id) {
    const heading = await waitForElement(() => document.getElementById(id), { timeoutMs: 2000, signal });
    heading?.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }
  return true;
}

const normalizeText = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();

/** Put a question into the open chat's composer and send it. */
async function askInOpenChat(question: string, signal?: AbortSignal) {
  const input = await waitForElement(() => document.querySelector<HTMLTextAreaElement>("textarea#learning-question"), { timeoutMs: 5000, signal });
  if (!input || input.closest("[hidden]")) return webMcpError("The chat is not available while a voice call is on screen.");
  const form = input.closest("form");
  // The composer has other type=button controls (Talk comes first), so look for Stop by its text.
  const stop = [...(form?.querySelectorAll<HTMLButtonElement>('button[type="button"]') ?? [])].some(button => button.textContent?.trim() === "Stop" || button.getAttribute("aria-label") === "Stop");
  if (stop) return webMcpError("The tutor is still answering. Try again when it finishes.");
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(input, question);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  const send = await waitForElement(() => {
    const button = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
    return button && !button.disabled ? button : null;
  }, { timeoutMs: 2000, signal });
  if (!send) return webMcpError("Could not send the question to the tutor.");
  send.click();
  return { asked: question, href: TALK_BOARD_PATH, note: "The tutor's answer streams into the chat on the page." };
}

export function OncoGuideWebMcpTools({ topics }: { topics: Topic[] }) {
  const router = useRouter();
  const push = (href: string) => router.push(href);

  const tools: WebMcpTool[] = [
    {
      name: "search_education",
      description: "Search every OncoGuide lesson for a concept. Returns matching sections with ids for read_section, open_page and show_passage.",
      inputSchema: { type: "object", properties: { query: { type: "string", description: "The concept to look up." }, limit: { type: "number", description: "Maximum results, 1-20 (default 8)." } }, required: ["query"], additionalProperties: false },
      annotations: { readOnlyHint: true },
      execute: async input => searchEducationSections(await loadCorpus(), str(input, "query"), Number(input.limit) || 8),
    },
    {
      name: "read_section",
      description: "Read the full text of one lesson section (up to 6000 characters).",
      inputSchema: { type: "object", properties: { section_id: sectionId }, required: ["section_id"], additionalProperties: false },
      annotations: { readOnlyHint: true },
      execute: async input => readEducationSection(await loadCorpus(), str(input, "section_id")),
    },
    {
      name: "lesson_sections",
      description: "List the sections (ids and headings) of a lesson.",
      inputSchema: { type: "object", properties: { slug: lessonSlug }, required: ["slug"], additionalProperties: false },
      annotations: { readOnlyHint: true },
      execute: async input => educationLessonSections(await loadCorpus(), str(input, "slug")),
    },
    {
      name: "list_lessons",
      description: "List every lesson in the OncoGuide curriculum, grouped by topic, with slugs and links.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      execute: () => ({
        lessons: topics.flatMap(topic => topic.pages.map(page => ({ slug: page.slug, title: page.title, href: `${educationHref(page.slug)}/`, topic: topic.title }))),
      }),
    },
    {
      name: "get_current_view",
      description: "Describe what the reader is looking at: the page path and title, the current lesson and its sections, the heading in view and any selected text.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      execute: async () => {
        const path = currentPath();
        const lesson = await loadCorpus().then(corpus => educationLessonAtPath(corpus, path)).catch(() => null);
        const params = new URLSearchParams(window.location.search);
        return {
          path, title: document.title,
          page: lesson ? "lesson" : path === TALK_BOARD_PATH ? "chat" : path.startsWith("/education/search") ? "search" : path === "/" || path === "/education/" ? "home" : "other",
          ...(params.get("q") ? { query: params.get("q") } : {}),
          lesson,
          visibleHeading: visibleHeading(article() ?? mainRoot()),
          selectedText: selectedPageText(),
        };
      },
    },
    {
      name: "open_page",
      description: "Take the reader to a lesson, or to a section of one. Pass a section_id (from search_education or lesson_sections) or a lesson slug. Resolves once the page is shown.",
      inputSchema: { type: "object", properties: { section_id: sectionId, slug: lessonSlug }, additionalProperties: false },
      execute: async (input, { signal }) => {
        const target = resolveEducationTarget(await loadCorpus(), input);
        if ("error" in target) return target;
        const { section } = target;
        if (!await goTo(push, section.href, signal)) return webMcpError("The page did not finish opening.", { href: section.href });
        return { opened: section.href, slug: section.slug, title: section.pageTitle, heading: section.heading };
      },
    },
    {
      name: "show_passage",
      description: "Scroll to and highlight a quoted passage so the reader can see it. Pass section_id to open that section first; otherwise the current page is searched, then the library.",
      inputSchema: { type: "object", properties: { quote: { type: "string", description: "Exact text from the lesson, ideally one sentence." }, section_id: sectionId }, required: ["quote"], additionalProperties: false },
      execute: async (input, { signal }) => {
        const quote = str(input, "quote");
        if (quote.length < 3) return webMcpError("Provide a longer quote.");
        let href: string | undefined;
        if (str(input, "section_id")) {
          const target = resolveEducationTarget(await loadCorpus(), input);
          if ("error" in target) return target;
          href = target.section.href;
        } else if (!(article() && findPassageElement(article()!, quote))) {
          // Not on this page: open the first section whose text contains it.
          const needle = normalizeText(quote).split(" ").slice(0, 12).join(" ");
          href = (await loadCorpus()).sections.find(section => normalizeText(section.text).includes(needle))?.href;
          if (!href) return webMcpError("That passage is not on this page or in any lesson.");
        }
        if (href && !await goTo(push, href, signal)) return webMcpError("The page did not finish opening.", { href });
        const element = await waitForElement(() => { const root = article(); return root ? findPassageElement(root, quote) : null; }, { timeoutMs: 4000, signal });
        if (!element) return webMcpError("That passage was not found on the page.", { path: currentPath() });
        highlightElement(element);
        return { shown: true, path: currentPath(), text: (element.textContent ?? "").trim().slice(0, 500) };
      },
    },
    {
      name: "ask_tutor",
      description: "Ask OncoGuide's learning chat a question on the reader's behalf. Opens the chat if needed and sends the question; the answer appears on the page.",
      inputSchema: { type: "object", properties: { question: { type: "string", description: "The question, written as the reader would ask it." } }, required: ["question"], additionalProperties: false },
      annotations: { consequentialHint: true },
      execute: async (input, { signal }) => {
        const question = str(input, "question").slice(0, 4000);
        if (!question) return webMcpError("Provide a question.");
        if (currentPath() === TALK_BOARD_PATH) return askInOpenChat(question, signal);
        const lesson = await loadCorpus().then(corpus => educationLessonAtPath(corpus, currentPath())).catch(() => null);
        const params = new URLSearchParams({ ...(lesson ? { lesson: lesson.slug } : {}), q: question });
        const href = `${TALK_BOARD_PATH}?${params}`;
        push(href);
        const ready = await waitForElement(() => currentPath() === TALK_BOARD_PATH ? document.querySelector("textarea#learning-question") : null, { timeoutMs: 8000, signal });
        return ready ? { asked: question, href, note: "The tutor's answer streams into the chat on the page." } : webMcpError("The chat did not finish opening.", { href });
      },
    },
  ];

  useWebMcpTools(tools, { key: "oncoguide" });
  return null;
}
