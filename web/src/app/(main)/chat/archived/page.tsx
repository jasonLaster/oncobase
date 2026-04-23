import { redirect } from "next/navigation";
import { ArchivedChatsClient } from "./client";
import { chatConfigured } from "@/lib/chat-config";

export default function ArchivedChatsPage() {
  if (!chatConfigured) {
    redirect("/");
  }

  return <ArchivedChatsClient />;
}
