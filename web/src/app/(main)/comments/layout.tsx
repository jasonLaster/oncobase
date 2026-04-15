import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const commentsEnabled =
  process.env.NEXT_PUBLIC_ENABLE_COMMENTS === "true";

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
