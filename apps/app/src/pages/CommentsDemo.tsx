import { Check, MessageSquare, SmilePlus } from "lucide-react";
import { useState } from "react";

type Reply = { id: string; author: string; initials: string; when: string; text: string; guest?: boolean };
type Thread = {
  id: string;
  quote?: string;
  resolved: boolean;
  likes: number;
  liked: boolean;
  replies: Reply[];
};

/** Fictional people and text. */
const initialThreads: Thread[] = [
  {
    id: "pdl1",
    quote: "Ask about eligibility and the PD-L1 result",
    resolved: false,
    likes: 2,
    liked: false,
    replies: [
      { id: "a", author: "Maya R.", initials: "MR", when: "2h", text: "Do we know yet if the PD-L1 test was run on the biopsy or on the surgery sample?" },
      { id: "b", author: "Dr. Ellis", initials: "DE", when: "1h", text: "The biopsy. The result should be back Friday." },
    ],
  },
  {
    id: "summary",
    resolved: false,
    likes: 0,
    liked: false,
    replies: [{ id: "c", author: "Swift Fox 472", initials: "SF", when: "3h", text: "This side-by-side view is really helpful, thank you.", guest: true }],
  },
  {
    id: "trials",
    quote: "Few open trials, and travel may be needed",
    resolved: true,
    likes: 1,
    liked: false,
    replies: [{ id: "d", author: "Jordan K.", initials: "JK", when: "1d", text: "Checked: two sites are within a day’s drive. Added to the trials page." }],
  },
];

export function CommentsDemo() {
  const [threads, setThreads] = useState(initialThreads);
  const [showAll, setShowAll] = useState(false);
  const [active, setActive] = useState<string | null>("pdl1");
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const update = (id: string, change: (thread: Thread) => Thread) =>
    setThreads((current) => current.map((thread) => (thread.id === id ? change(thread) : thread)));
  const visible = threads.filter((thread) => showAll || !thread.resolved);
  const unresolved = threads.filter((thread) => !thread.resolved).length;
  const anchored = (id: string) => threads.find((thread) => thread.id === id)!;

  const highlight = (id: string, text: string) => {
    const thread = anchored(id);
    return (
      <mark
        aria-label={`Comment on: ${text}`}
        className="ft-cm-mark"
        data-active={active === id || undefined}
        data-resolved={thread.resolved || undefined}
        onClick={() => {
          setActive(id);
          if (thread.resolved) setShowAll(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setActive(id);
            if (thread.resolved) setShowAll(true);
          }
        }}
        role="button"
        tabIndex={0}
      >
        {text}
      </mark>
    );
  };

  return (
    <div className="ft-cm lp-browser">
      <div className="ft-cm-bar">
        <span className="ft-cm-slug">wiki/treatment/options</span>
        <span>Sample comments</span>
      </div>
      <div className="ft-cm-body">
        <article className="ft-cm-article wiki-markdown" aria-label="Page with highlighted passages">
          <h3>Treatment options</h3>
          <p>
            A side-by-side look at the options we are weighing, with the question to ask next. For the checkpoint
            inhibitor, <strong>{highlight("pdl1", "Ask about eligibility and the PD-L1 result")}</strong> before the next
            visit.
          </p>
          <p>
            For the targeted trial, {highlight("trials", "Few open trials, and travel may be needed")}, so we are
            collecting sites.
          </p>
          <p className="ft-cm-tip">Click a highlight to jump to its thread.</p>
        </article>
        <aside className="ft-cm-pane" aria-label="Comments">
          <div className="ft-cm-tabs" aria-hidden="true">
            <span data-on>Comments</span>
            <span>Outline</span>
          </div>
          <div className="ft-cm-head">
            <span>
              {visible.length} {showAll ? "total" : "unresolved"} thread{visible.length === 1 ? "" : "s"}
            </span>
            <button onClick={() => setShowAll((value) => !value)} type="button">
              {showAll ? "Show unresolved only" : "View all threads"}
            </button>
          </div>
          <div className="ft-cm-threads">
            {visible.map((thread) => (
              <section
                className="ft-cm-thread"
                data-active={active === thread.id || undefined}
                data-resolved={thread.resolved || undefined}
                key={thread.id}
                onClick={() => setActive(thread.id)}
              >
                {thread.quote ? <blockquote>{thread.quote}</blockquote> : <p className="ft-cm-pagelevel">On the page</p>}
                {thread.replies.map((reply) => (
                  <div className="ft-cm-comment" key={reply.id}>
                    <span className="ft-cm-avatar" data-guest={reply.guest || undefined}>
                      {reply.initials}
                    </span>
                    <div>
                      <p className="ft-cm-meta">
                        <strong>{reply.author}</strong> <span>{reply.when}</span>
                        {reply.guest ? <em>Guest</em> : null}
                      </p>
                      <p>{reply.text}</p>
                    </div>
                  </div>
                ))}
                <div className="ft-cm-actions">
                  <button
                    aria-pressed={thread.liked}
                    onClick={() => update(thread.id, (value) => ({ ...value, liked: !value.liked, likes: value.likes + (value.liked ? -1 : 1) }))}
                    type="button"
                  >
                    {thread.likes > 0 ? <span aria-hidden="true">👍</span> : <SmilePlus aria-hidden="true" size={15} />}
                    {thread.likes > 0 ? thread.likes : "React"}
                  </button>
                  <button onClick={() => update(thread.id, (value) => ({ ...value, resolved: !value.resolved }))} type="button">
                    <Check aria-hidden="true" size={15} /> {thread.resolved ? "Reopen" : "Resolve"}
                  </button>
                </div>
                <form
                  className="ft-cm-reply"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const text = (drafts[thread.id] ?? "").trim();
                    if (!text) return;
                    update(thread.id, (value) => ({
                      ...value,
                      replies: [...value.replies, { id: `r${value.replies.length}-${text.length}`, author: "You", initials: "YO", when: "now", text }],
                    }));
                    setDrafts((current) => ({ ...current, [thread.id]: "" }));
                  }}
                >
                  <label className="ft-cm-sr" htmlFor={`reply-${thread.id}`}>
                    Reply to this thread
                  </label>
                  <input
                    id={`reply-${thread.id}`}
                    onChange={(event) => setDrafts((current) => ({ ...current, [thread.id]: event.target.value }))}
                    placeholder="Reply…"
                    value={drafts[thread.id] ?? ""}
                  />
                  <button type="submit">Send</button>
                </form>
              </section>
            ))}
            {visible.length === 0 ? (
              <p className="ft-cm-empty">
                <MessageSquare aria-hidden="true" size={16} /> All caught up. {unresolved === 0 ? "Everything is resolved." : ""}
              </p>
            ) : null}
          </div>
        </aside>
      </div>
    </div>
  );
}
