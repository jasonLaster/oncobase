import Link from "next/link";
import { WikiMarkdownFrame } from "@oncobase/wiki-markdown/frame";
import { findPage, pages, educationHref } from "../lib/content.server";
import { ArticleEnhancements } from "./article-enhancements";
import { notFound } from "next/navigation";
export type LessonParams = Promise<{ slug: string[] }>;
export async function lessonFromParams(params: LessonParams) {
  const { slug } = await params;
  const key = `wiki/education/${slug.join("/")}`;
  const page = findPage(key) ?? findPage(`${key}/index`);
  if (!page) notFound();
  return page;
}
export function lessonStaticParams() {
  return pages.flatMap(page => {
    const slug = page.slug.slice("wiki/education/".length).split("/");
    return slug.at(-1) === "index" && slug.length > 1 ? [{ slug }, { slug: slug.slice(0, -1) }] : [{ slug }];
  });
}
export async function lessonMetadata({ params }: { params: LessonParams }) {
  const page = await lessonFromParams(params);
  return { title: page.title, description: page.description,
    alternates: { canonical: educationHref(page.slug) }, openGraph: { title: page.title, type: "article" as const, url: educationHref(page.slug) } };
}
export async function Lesson({ params }: { params: LessonParams }) {
  const page = await lessonFromParams(params);
  return <article className="edu-article" data-test-id="education-article">
    <nav className="edu-breadcrumbs" aria-label="Breadcrumb"><Link href="/education">Education</Link><span aria-hidden="true">/</span><span>{page.title}</span></nav>
    <div className="edu-eyebrow">THE EDUCATION LIBRARY</div><h1>{page.title}</h1>
    {page.description ? <p className="edu-article-description">{page.description}</p> : null}
    <div className="edu-article-rule" />
    <WikiMarkdownFrame data-guide-markdown key={page.slug}>
      <div dangerouslySetInnerHTML={{ __html: page.html }} />
      <ArticleEnhancements slug={page.slug} tables={page.html.includes("<table")} slides={page.html.includes("data-wiki-slides")} />
    </WikiMarkdownFrame>
    <footer className="edu-article-footer"><Link href="/education">All topics</Link><a href={`https://github.com/jasonLaster/oncoguide/blob/main/${page.slug}.md`}>View this lesson’s Markdown</a></footer>
  </article>;
}
