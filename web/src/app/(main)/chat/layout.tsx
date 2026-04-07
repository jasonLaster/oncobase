import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export const chatEnabled =
  process.env.NEXT_PUBLIC_ENABLE_CHAT === "true" 

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
