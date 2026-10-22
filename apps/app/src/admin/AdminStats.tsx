import { useEffect, useState } from "react";
import type { AdminStats as Stats, FolderCount, MonthCount } from "../../server/admin-stats";

type StatsResponse = Stats & { people: { users: number; roles: number } };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const number = new Intl.NumberFormat("en-US");
const count = (value: number, noun: string) => `${number.format(value)} ${noun}${value === 1 ? "" : "s"}`;

function useAdminStats() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/admin/stats", { credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok) throw new Error(await response.text());
        return (await response.json()) as StatsResponse;
      })
      .then((value) => { if (!cancelled) setStats(value); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)); });
    return () => { cancelled = true; };
  }, []);
  return { stats, error };
}

function StatTile({ label, value, detail }: { label: string; value: number; detail?: string }) {
  return (
    <div className="admin-stat" data-test-id="admin-stat">
      <span className="admin-stat-label">{label}</span>
      <strong className="admin-stat-value">{number.format(value)}</strong>
      {detail ? <span className="admin-stat-detail">{detail}</span> : null}
    </div>
  );
}

function MonthBars({ title, unit, months }: { title: string; unit: string; months: MonthCount[] }) {
  if (months.length === 0) return null;
  const max = Math.max(...months.map((month) => month.count));
  return (
    <figure className="admin-month-chart">
      <figcaption>{title}</figcaption>
      <ol className="admin-month-bars" aria-label={title}>
        {months.map(({ month, count }) => {
          const label = `${MONTHS[Number(month) - 1]}: ${number.format(count)} ${unit}`;
          return (
            <li key={month} title={label} aria-label={label}>
              <span className="admin-month-value" aria-hidden="true">{count}</span>
              <span className="admin-month-bar" style={{ height: `${Math.max(4, (count / max) * 100)}%` }} />
              <span className="admin-month-label" aria-hidden="true">{MONTHS[Number(month) - 1]}</span>
            </li>
          );
        })}
      </ol>
    </figure>
  );
}

function FolderTable({ caption, prefix, folders }: { caption: string; prefix: string; folders: FolderCount[] }) {
  if (folders.length === 0) return null;
  return (
    <div className="admin-table-wrap admin-stats-table">
      <table>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr><th scope="col">Folder</th><th scope="col">Pages</th><th scope="col">Restricted</th></tr>
        </thead>
        <tbody>
          {folders.map((folder) => (
            <tr key={folder.folder}>
              <td><code>{folder.folder === "(top level)" ? prefix || "/" : `${prefix}${folder.folder}/`}</code></td>
              <td>{number.format(folder.pages)}</td>
              <td>{number.format(folder.restricted)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const percent = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "0%");

export function AdminStats() {
  const { stats, error } = useAdminStats();
  if (error) return <p className="admin-error">Could not load statistics: {error}</p>;
  if (!stats) return <p className="admin-muted" aria-live="polite" data-test-id="admin-stats-loading">Loading statistics…</p>;

  const { content, records, people } = stats;
  const { calls, emails } = content;
  return (
    <div className="admin-stats" data-test-id="admin-stats">
      <section aria-labelledby="admin-stats-calls">
        <h2 id="admin-stats-calls">Calls and emails</h2>
        <div className="admin-stat-grid">
          <StatTile label="Calls" value={calls.calls} detail={`${count(calls.pages, "page")} in sources/meeting-notes`} />
          <StatTile label="Call transcripts" value={calls.transcripts} detail={`${number.format(calls.formatted)} formatted, ${count(calls.overviews, "overview")}`} />
          <StatTile label="Redacted calls" value={calls.redacted} detail={`${percent(calls.redacted, calls.calls)} of calls, ${count(calls.redactionBlocks, "redaction")}`} />
          <StatTile label="Restricted calls" value={calls.restricted} detail="Hidden from readers without access" />
          <StatTile label="Emails" value={emails.emails} detail={`${number.format(emails.restricted)} restricted`} />
          <StatTile label="Redacted emails" value={emails.redacted} detail={count(emails.redactionBlocks, "redaction")} />
        </div>
        <div className="admin-month-grid">
          <MonthBars title="Calls by month" unit="calls" months={calls.byMonth} />
          <MonthBars title="Emails by month" unit="emails" months={emails.byMonth} />
        </div>
      </section>

      <section aria-labelledby="admin-stats-content">
        <h2 id="admin-stats-content">Content</h2>
        <div className="admin-stat-grid">
          <StatTile label="Published pages" value={content.totals.pages} detail={`${number.format(content.totals.restricted)} restricted`} />
          <StatTile label="Source artifacts" value={content.sources.pages} detail={`${number.format(content.sources.restricted)} restricted`} />
          <StatTile label="Wiki articles" value={content.wiki.pages} detail={`${number.format(content.wiki.restricted)} restricted`} />
          <StatTile label="Education lessons" value={content.education.pages} detail="Pages in wiki/education" />
        </div>
        <div className="admin-stats-columns">
          <div>
            <h3>Sources by folder</h3>
            <FolderTable caption="Source pages by folder" prefix="sources/" folders={content.sources.folders} />
          </div>
          <div>
            <h3>Wiki by folder</h3>
            <FolderTable caption="Wiki pages by folder" prefix="wiki/" folders={content.wiki.folders} />
            {content.other.length > 0 ? (
              <>
                <h3>Other folders</h3>
                <FolderTable caption="Other pages by folder" prefix="" folders={content.other} />
              </>
            ) : null}
          </div>
        </div>
      </section>

      <section aria-labelledby="admin-stats-files">
        <h2 id="admin-stats-files">Files and activity</h2>
        <div className="admin-stat-grid">
          <StatTile label="PDFs" value={records.pdfAssets} />
          <StatTile label="Other files" value={records.fileAssets} />
          <StatTile label="Imaging series" value={records.dicomSeries} detail={count(records.dicomImages, "DICOM image")} />
          <StatTile label="Pathology slides" value={records.pathologySlides} />
          <StatTile label="Users" value={people.users} detail={count(people.roles, "role")} />
          <StatTile label="Comment threads" value={records.commentThreads} detail={`On ${count(records.commentRooms, "page")}`} />
          <StatTile label="Active share links" value={records.pageShares} />
        </div>
      </section>
      <p className="admin-muted admin-stats-footnote">
        Redacted counts pages whose source contains <code>:::redact</code> blocks or <code>&lt;redact&gt;</code> tags.
        Restricted pages are marked <code>sensitive: true</code>. Generated {new Date(stats.generatedAt).toLocaleString()}.
      </p>
    </div>
  );
}
