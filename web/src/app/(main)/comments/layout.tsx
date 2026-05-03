import { redirect } from "next/navigation";

const commentsEnabled =
  process.env.NEXT_PUBLIC_ENABLE_COMMENTS === "true";

// Comments call Convex queries that need user auth; render dynamic.
export const dynamic = "force-dynamic";

export default function CommentsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!commentsEnabled) {
    redirect("/");
  }

  return <>{children}</>;
}
