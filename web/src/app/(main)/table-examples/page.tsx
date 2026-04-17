import { buildExampleTablesDocument } from "@diana-tnbc/smart-table/examples";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { DocumentComments } from "@/components/document-comments-wrapper";

export default function TableExamplesPage() {
  const content = buildExampleTablesDocument();

  return (
    <DocumentComments
      documentSlug="table-examples"
      documentTitle="Smart Table Examples"
    >
      <header className="mb-6">
        <h1 className="text-3xl font-bold">Smart Table Examples</h1>
        <p className="mt-2 max-w-3xl text-[var(--text-muted)]">
          Controlled table fixtures for exercising expansion, overflow,
          resizing, and markdown rendering behavior without depending on a
          production wiki page.
        </p>
      </header>
      <MarkdownRenderer content={content} currentSlug="table-examples" />
    </DocumentComments>
  );
}
