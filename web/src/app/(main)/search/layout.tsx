import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Search",
  description: "Search across all wiki pages",
  openGraph: { title: "Search", description: "Search across all wiki pages" },
};

// Search hits Convex; keep it dynamic.
export const dynamic = "force-dynamic";

export default function SearchLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
