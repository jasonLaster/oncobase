import Link from "next/link";
import { ArrowRight, BookOpen, Dna } from "lucide-react";
import { topics, pages, educationHref } from "../lib/content.server";
export function EducationHome() {
  const start = pages.find(page => page.slug === "wiki/education/oncology-101/index") ?? pages[0]!;
  return <section>
    <div className="edu-eyebrow"><span />THE EDUCATION LIBRARY</div>
    <div className="edu-hero">
      <h1>Cancer science,<br /><em>made approachable.</em></h1>
      <p className="edu-lead">Understand the biology, explore how treatments work, and learn to read the evidence. Open lessons, visual explanations, and connected ideas.</p>
      <Dna className="edu-hero-art" strokeWidth={0.65} aria-hidden="true" />
      <div className="edu-hero-actions"><Link className="edu-start" href={educationHref(start.slug)}>Start with the basics <ArrowRight size={16} /></Link><a className="edu-browse" href="#education-topics">Browse all topics <ArrowRight size={16} /></a></div>
    </div>
    <div className="edu-section-heading" id="education-topics"><h2>The education library</h2><span>{pages.length} lessons · Free to explore</span></div>
    <div className="edu-topic-grid">{topics.map(topic => <Link href={educationHref(topic.entry.slug)} key={topic.key} className="edu-topic-card">
      <div className="edu-topic-top"><BookOpen size={22} /><span>{topic.pages.length} lessons</span></div>
      <h3>{topic.title}</h3><p>{topic.description}</p><div className="edu-topic-bottom">Explore topic <ArrowRight size={16} /></div>
    </Link>)}</div>
    <div className="edu-home-footer"><BookOpen size={18} /><p>Read at your own pace. Follow a guide or explore a concept. The content and its sources are open to everyone.</p></div>
  </section>;
}
