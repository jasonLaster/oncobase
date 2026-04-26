import { redirect } from "next/navigation";
import { ArchivedChatsClient } from "./archived-client";

export default function ArchivedChatsPage({
  chatConfigured,
}: {
  chatConfigured: boolean;
}) {
  if (!chatConfigured) {
    redirect("/");
  }

  return <ArchivedChatsClient />;
}
