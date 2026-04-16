import type { Metadata } from "next";
import { Suspense } from "react";
import { CommentsPageClient } from "@/components/comments-page-client";

export const metadata: Metadata = {
  title: "Comments",
  description: "Recent comments and discussions",
  openGraph: { title: "Comments", description: "Recent comments and discussions" },
};

function CommentsPageFallback() {
  return (
    <div className="space-y-4">
      <div className="h-10 w-40 animate-pulse rounded-xl bg-[var(--accent-light)]" />
      <div className="h-28 animate-pulse rounded-2xl border border-[var(--sidebar-border)] bg-[var(--card)]" />
      <div className="h-28 animate-pulse rounded-2xl border border-[var(--sidebar-border)] bg-[var(--card)]" />
      <div className="h-28 animate-pulse rounded-2xl border border-[var(--sidebar-border)] bg-[var(--card)]" />
    </div>
  );
}

export default function CommentsPage() {
  return (
    <div className="overflow-y-auto h-full">
      <section className="mx-auto max-w-5xl px-4 py-4 md:px-8 md:py-8">
        <Suspense fallback={<CommentsPageFallback />}>
          <CommentsPageClient />
        </Suspense>
      </section>
    </div>
  );
}
