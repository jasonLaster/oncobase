import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const chatEnabled =
  process.env.NEXT_PUBLIC_ENABLE_CHAT === "true" ||
  process.env.NODE_ENV === "development";

export default function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!chatEnabled) {
    redirect("/");
  }

  return <>{children}</>;
}
