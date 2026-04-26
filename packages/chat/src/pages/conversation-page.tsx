import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ConversationPageClient } from "./conversation-client";

function ChatLoading() {
  return (
    <div className="flex items-center justify-center h-full text-sm text-[var(--text-muted)]">
      <span className="inline-block w-4 h-4 border-2 border-[var(--text-muted)] border-t-transparent rounded-full animate-spin mr-2" />
      Loading conversation...
    </div>
  );
}

async function ConversationContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ConversationPageClient id={id} />;
}

export default function ConversationPage({
  chatConfigured,
  params,
}: {
  chatConfigured: boolean;
  params: Promise<{ id: string }>;
}) {
  if (!chatConfigured) {
    redirect("/");
  }

  return (
    <Suspense fallback={<ChatLoading />}>
      <ConversationContent params={params} />
    </Suspense>
  );
}
