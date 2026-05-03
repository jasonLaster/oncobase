import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Search",
  description: "Search across all wiki pages",
  openGraph: { title: "Search", description: "Search across all wiki pages" },
};

export default function SearchLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
