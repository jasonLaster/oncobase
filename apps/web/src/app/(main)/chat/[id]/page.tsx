import { Suspense } from "react";
import { connection } from "next/server";
import ConversationPage from "@diana-tnbc/chat/pages/conversation-page";
import { chatConfigured } from "@/lib/chat-config";
import Loading from "./loading";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await connection();

  return (
    <Suspense fallback={<Loading />}>
      <ConversationPage chatConfigured={chatConfigured} params={params} />
    </Suspense>
  );
}
