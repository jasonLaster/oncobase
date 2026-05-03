import { buildExampleTablesDocument } from "@diana-tnbc/smart-table/examples";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { DeclarativeSmartTableExample } from "@/components/declarative-smart-table-example";
import { DocumentComments } from "@/components/document-comments-wrapper";

// DocumentComments wraps a Convex client; render dynamic.
export const dynamic = "force-dynamic";

export default function TableExamplesPage() {
  const content = buildExampleTablesDocument();

  return (
    <DocumentComments
      documentSlug="table-examples"
      documentTitle="Smart Table Examples"
    >
      <header className="mb-8 max-w-4xl">
        <h1 className="text-3xl font-bold">Smart Table Examples</h1>
        <p className="mt-2 max-w-3xl text-[var(--text-muted)]">
          A purpose-built QA surface for the smart-table package. It highlights
          the React API, the markdown-enhanced path, and the resize scenarios we
          care about most when we’re chasing smooth 60fps interactions.
        </p>
      </header>

      <DeclarativeSmartTableExample />

      <section className="mt-12">
        <div className="max-w-4xl">
          <h2 className="text-2xl font-semibold">Markdown Enhancement Fixtures</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">
            These fixtures travel through the markdown renderer so we can keep
            server-rendered styling, client enhancement, and legacy directive
            cleanup covered by the same page.
          </p>
        </div>
        <div className="mt-6">
          <MarkdownRenderer content={content} currentSlug="table-examples" />
        </div>
      </section>
    </DocumentComments>
  );
}
