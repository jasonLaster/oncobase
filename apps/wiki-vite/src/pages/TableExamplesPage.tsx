import { WikiMarkdown, type WikiMarkdownLinkProps } from "@diana-tnbc/wiki-markdown";
import { buildExampleTablesDocument } from "@diana-tnbc/smart-table/examples";
import { useMemo } from "react";
import { Link, useNavigate } from "react-router";
import { wikiViteSmartTableLayoutAdapter } from "../shell/smart-table-layout-adapter";

function routeLink({ href, children, ...props }: WikiMarkdownLinkProps) {
  return (
    <Link to={href ?? "#"} {...props}>
      {children}
    </Link>
  );
}

export function TableExamplesPage() {
  const navigate = useNavigate();
  const content = useMemo(() => buildExampleTablesDocument(), []);
  const routeAdapter = useMemo(
    () => ({
      push: (href: string) => navigate(href),
    }),
    [navigate],
  );

  return (
    <div className="page-layout">
      <article className="page-shell" data-test-id="document-article">
        <header className="page-header">
          <div>
            <h1>Table Examples</h1>
            <p>Smart table layout fixtures for reader parity checks.</p>
          </div>
        </header>
        <WikiMarkdown
          content={content}
          currentSlug="table-examples"
          LinkComponent={routeLink}
          routeAdapter={routeAdapter}
          tableLayoutAdapter={wikiViteSmartTableLayoutAdapter}
        />
      </article>
    </div>
  );
}
