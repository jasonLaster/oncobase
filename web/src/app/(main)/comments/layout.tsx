import { redirect } from "next/navigation";

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
