import { Suspense } from "react";
import { Header } from "@/components/header";
import { NavigationShell } from "@/components/navigation-shell";
import { WebChatRuntimeProvider } from "@/components/chat-runtime-provider";

function MainContentFallback() {
  return (
    <div className="h-full overflow-y-auto" role="status" aria-label="Loading page">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-4 md:px-8 md:py-8">
        <div className="min-w-0 flex-1">
          <article className="relative mx-auto max-w-4xl overflow-visible pr-4 md:pr-8">
            <div className="mb-6 flex items-start justify-between gap-3">
              <div className="h-9 w-2/3 max-w-2xl animate-pulse rounded-md bg-[var(--accent-light)]" />
              <div className="h-8 w-8 shrink-0 animate-pulse rounded-md bg-[var(--accent-light)]" />
            </div>
            <div className="space-y-4">
              <div className="h-4 w-full animate-pulse rounded bg-[var(--accent-light)]" />
              <div className="h-4 w-[92%] animate-pulse rounded bg-[var(--accent-light)]" />
              <div className="h-4 w-[76%] animate-pulse rounded bg-[var(--accent-light)]" />
              <div className="h-28 w-full animate-pulse rounded-lg bg-[var(--accent-light)]" />
            </div>
          </article>
        </div>
      </div>
    </div>
  );
}

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <WebChatRuntimeProvider>
      <div className="grid grid-rows-[auto_1fr] h-dvh overflow-hidden">
        <Suspense fallback={<div className="h-12 shrink-0 border-b border-[var(--sidebar-border)] bg-[var(--sidebar-bg)]" />}>
          <Header />
        </Suspense>
        <Suspense fallback={<MainContentFallback />}>
          <NavigationShell initialTree={[]}>{children}</NavigationShell>
        </Suspense>
      </div>
    </WebChatRuntimeProvider>
  );
}
