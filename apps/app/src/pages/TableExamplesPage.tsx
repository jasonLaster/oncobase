import { WikiMarkdown, type WikiMarkdownLinkProps } from "@oncobase/wiki-markdown";
import { buildExampleTablesDocument } from "@oncobase/smart-table/examples";
import { WikiPageFrame, WikiPageHeader } from "@oncobase/wiki-shell/page-chrome";
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
    <WikiPageFrame className="page-shell" data-test-id="document-article">
      <WikiPageHeader title="Table Examples" description="Smart table layout fixtures for reader parity checks." />
      <WikiMarkdown
        content={content}
        currentSlug="table-examples"
        LinkComponent={routeLink}
        routeAdapter={routeAdapter}
        tableLayoutAdapter={wikiViteSmartTableLayoutAdapter}
      />
    </WikiPageFrame>
  );
}
