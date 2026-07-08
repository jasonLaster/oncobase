import { useEffect, useState } from "react";
import { useLocation, useParams } from "react-router";

type PiiPage = {
  slug: string;
  title: string;
  content: string;
  rawContent?: string;
};

export function PiiViewPage() {
  const params = useParams();
  const location = useLocation();
  const slug = params["*"] ?? "";
  const [page, setPage] = useState<PiiPage | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!slug) return;
    void fetch(`/api/admin/pii/${encodeURIComponent(slug)}`, {
      credentials: "same-origin",
    }).then(async (response) => {
      if (response.status === 401) {
        window.location.assign("/");
        return;
      }
      if (!response.ok) throw new Error(await response.text());
      setPage((await response.json()) as PiiPage);
    }).catch((err) => {
      setError(err instanceof Error ? err.message : String(err));
    });
  }, [slug, location.key]);

  if (error) {
    return <article className="page-shell"><p className="app-error">{error}</p></article>;
  }
  if (!page) {
    return <article className="page-shell"><div className="loading-line">Loading page</div></article>;
  }

  return (
    <article className="page-shell">
      <h1>{page.title}</h1>
      <pre className="pii-view-content">{page.rawContent ?? page.content}</pre>
    </article>
  );
}
