import { redirect } from "next/navigation";
import { commentsFeatureEnabled } from "@/lib/comments-feature";

export default function CommentsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!commentsFeatureEnabled()) {
    redirect("/");
  }

  return <>{children}</>;
}
