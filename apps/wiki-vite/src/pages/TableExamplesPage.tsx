import {
  WikiMarkdown,
  type WikiMarkdownLinkProps,
} from "@oncobase/wiki-markdown";
import { DocumentComments } from "@oncobase/wiki-comments/wrapper";
import { openWikiAuthDialog } from "@oncobase/wiki-shell";
import { DeclarativeSmartTableShowcase } from "@oncobase/smart-table";
import { buildExampleTablesDocument } from "@oncobase/smart-table/examples";
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
    <DocumentComments
      articleClassName="page-shell"
      contentKey="table-examples"
      documentSlug="table-examples"
      documentTitle="Smart Table Examples"
      mobileRail={false}
      onSignIn={() => openWikiAuthDialog("signin")}
      pathname="/table-examples"
    >
      <header className="mb-8 max-w-4xl">
        <h1 className="text-3xl font-bold">Smart Table Examples</h1>
        <p className="mt-2 max-w-3xl text-[var(--text-muted)]">
          A purpose-built QA surface for the smart-table package. It highlights
          the React API, the markdown-enhanced path, and the resize scenarios we
          care about most when we’re chasing smooth 60fps interactions.
        </p>
      </header>

      <DeclarativeSmartTableShowcase
        layoutAdapter={wikiViteSmartTableLayoutAdapter}
      />

      <section className="mt-12">
        <div className="max-w-4xl">
          <h2 className="text-2xl font-semibold">
            Markdown Enhancement Fixtures
          </h2>
          <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">
            These fixtures travel through the markdown renderer so we can keep
            server-rendered styling, client enhancement, and legacy directive
            cleanup covered by the same page.
          </p>
        </div>
        <div className="mt-6">
          <WikiMarkdown
            content={content}
            currentSlug="table-examples"
            LinkComponent={routeLink}
            routeAdapter={routeAdapter}
            tableLayoutAdapter={wikiViteSmartTableLayoutAdapter}
          />
        </div>
      </section>
    </DocumentComments>
  );
}
