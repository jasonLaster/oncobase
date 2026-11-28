import { useMemo } from "react";
import { Link, useSearchParams } from "react-router";
import { adoptStyles } from "../../lazy-styles";
import { EMPTY_READER_ROWS, readerQuery, useInitialReaderData, useReaderQuery } from "../../bootstrap/reader-queries";
import { currentSiteBrand } from "../../site-host";
import type { PageIndexRow } from "../../types";
import { useWikiIdentityPending } from "../../wiki-context";
import {
  AUDIENCE_LABELS,
  STATUS_LABELS,
  groupTools,
  toolAvailability,
  toolsForBrand,
  type ToolAudience,
  type ToolAvailability,
  type ToolEntry,
} from "./tools-config";
import toolsCss from "./tools.css?inline";

adoptStyles("tools", toolsCss);

const AUDIENCES = Object.keys(AUDIENCE_LABELS) as ToolAudience[];

export function ToolsPage() {
  const [params, setParams] = useSearchParams();
  const initial = useInitialReaderData();
  const rows = useReaderQuery(readerQuery.pageIndex, initial?.pages ?? EMPTY_READER_ROWS) as PageIndexRow[];
  const identityPending = useWikiIdentityPending();
  const readable = useMemo(() => new Set((rows ?? []).map((row) => row.slug)), [rows]);
  const audience = AUDIENCES.find((a) => a === params.get("for")) ?? null;
  const tools = toolsForBrand(currentSiteBrand());
  const groups = groupTools(
    tools.filter((tool) => !audience || tool.audience.includes(audience)),
    (tool) => toolAvailability(tool, readable, identityPending),
  );

  return (
    <article className="tools-page" data-test-id="tools-page">
      <header className="tools-header">
        <h1>Tools</h1>
        <p>Interactive views of the record: each one says who it is for, what it shows and the question it answers.</p>
      </header>
      <div className="tools-filter" role="radiogroup" aria-label="Show tools for">
        {[null, ...AUDIENCES].map((value) => (
          <button key={value ?? "all"} type="button" role="radio" aria-checked={audience === value}
            className={audience === value ? "active" : ""}
            onClick={() => {
              const next = new URLSearchParams(params);
              if (value) next.set("for", value); else next.delete("for");
              setParams(next, { replace: true });
            }}>
            {value ? AUDIENCE_LABELS[value] : "All tools"}
          </button>
        ))}
      </div>
      {groups.length === 0 ? <p className="tools-muted">No tools match this filter.</p> : null}
      {groups.map((group) => (
        <section key={group.status} className="tools-group" aria-labelledby={`tools-${group.status}`}>
          <h2 id={`tools-${group.status}`}>{STATUS_LABELS[group.status].title}</h2>
          <p className="tools-muted">{STATUS_LABELS[group.status].description}</p>
          <ul className="tools-grid">
            {group.tools.map(({ tool, availability }) => <ToolCard key={tool.id} tool={tool} availability={availability} />)}
          </ul>
        </section>
      ))}
    </article>
  );
}

function ToolCard({ tool, availability }: { tool: ToolEntry; availability: ToolAvailability }) {
  const locked = availability !== "open";
  const body = (
    <>
      <div className="tools-card-top">
        <h3>{tool.title}</h3>
        {locked ? <span className="tools-lock">{availability === "checking" ? "Checking access…" : "Restricted"}</span> : null}
      </div>
      <ul className="tools-audience" aria-label="Who it is for">
        {tool.audience.map((a) => <li key={a} className={`tools-tag ${a}`}>{AUDIENCE_LABELS[a]}</li>)}
      </ul>
      <p>{tool.shows}</p>
      <p className="tools-question"><strong>Answers:</strong> {tool.question}</p>
      {tool.help ? <p className="tools-help"><strong>Help wanted:</strong> {tool.help}</p> : null}
      {tool.access.kind === "page" && availability === "locked" ? <p className="tools-muted tools-small">{tool.access.requirement}</p> : null}
    </>
  );
  return (
    <li className={`tools-card${locked ? " locked" : ""}`} data-tool-id={tool.id} data-availability={availability}>
      {locked ? <div className="tools-card-body" aria-disabled="true">{body}</div>
        : <Link className="tools-card-body" to={tool.href}>{body}</Link>}
    </li>
  );
}
