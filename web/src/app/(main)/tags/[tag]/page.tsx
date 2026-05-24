import type { Metadata } from "next";
import Link from "next/link";
import { cookies, headers } from "next/headers";
import { unstable_noStore as noStore } from "next/cache";
import { connection } from "next/server";
import { ChevronRight } from "lucide-react";
import { getPagesByTag } from "@/lib/markdown";
import { getSessionUserFromCookieHeader } from "@/lib/session-user";
import { siteDataFromRequest } from "@/lib/site-data";
import {
  buildTaggedPageTree,
  type TaggedPageTreeNode,
} from "@/lib/tag-page-groups";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tag: string }>;
}): Promise<Metadata> {
  const { tag } = await params;
  const decodedTag = decodeURIComponent(tag);
  const pages = await getPagesByTag(decodedTag);
  const description = `${pages.length} pages tagged "${decodedTag}"`;
  return {
    title: `Tag: ${decodedTag}`,
    description,
    openGraph: { title: `Tag: ${decodedTag}`, description },
  };
}

async function getVisiblePagesByTag(tag: string) {
  const [cookieStore, requestHeaders] = await Promise.all([
    cookies(),
    headers(),
  ]);
  const headerStore = new Headers(requestHeaders);
  const cookieHeader = headerStore.get("cookie") ?? cookieStore.toString();
  headerStore.set("cookie", cookieHeader);
  const request = { headers: headerStore };
  const siteData = siteDataFromRequest(request);
  const user = await getSessionUserFromCookieHeader(cookieHeader, headerStore);
  const pages = await getPagesByTag(tag, {
    includeSensitive: true,
  });

  if (!user) return pages.filter((page) => page.sensitive !== true);

  const visible = await Promise.all(
    pages.map(async (page) => {
      if (page.sensitive !== true) return page;
      const canAccess = await siteData.access.canUserAccessSlug({
        userId: user._id,
        slug: page.slug,
      });
      return canAccess ? page : null;
    }),
  );

  return visible.filter((page): page is NonNullable<typeof page> => page !== null);
}

function TaggedPageTree({
  node,
  level = 0,
}: {
  node: TaggedPageTreeNode;
  level?: number;
}) {
  return (
    <ul
      className={
        level === 0
          ? "space-y-3"
          : "ml-4 mt-2 space-y-2 border-l border-[var(--border)] pl-4"
      }
    >
      {node.pages.map((page) => (
        <li key={page.slug}>
          <Link
            href={`/${page.slug}`}
            className="text-[var(--brand)] hover:underline"
          >
            {page.title}
          </Link>
        </li>
      ))}
      {node.children.map((child) => (
        <li key={child.path}>
          <details open className="group">
            <summary className="cursor-pointer select-none list-none text-sm font-medium text-[var(--text)] marker:hidden">
              <ChevronRight
                aria-hidden="true"
                size={14}
                className="mr-1 inline-block text-[var(--text-muted)] transition-transform group-open:rotate-90"
              />
              {child.name}
            </summary>
            <TaggedPageTree node={child} level={level + 1} />
          </details>
        </li>
      ))}
    </ul>
  );
}

export default async function TagPage({
  params,
}: {
  params: Promise<{ tag: string }>;
}) {
  await connection();
  noStore();

  const { tag } = await params;
  const decodedTag = decodeURIComponent(tag);
  const pages = await getVisiblePagesByTag(decodedTag);
  const pageTree = buildTaggedPageTree(pages);

  return (
    <div className="overflow-y-auto h-full">
      <article className="px-4 py-4 md:px-8 md:py-8 max-w-4xl mx-auto">
        <header className="mb-6">
          <h1 className="text-3xl font-bold">Tag: {decodedTag}</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            {pages.length} {pages.length === 1 ? "page" : "pages"}
          </p>
        </header>
        {pages.length === 0 ? (
          <p className="text-[var(--text-muted)]">No pages found with this tag.</p>
        ) : (
          <TaggedPageTree node={pageTree} />
        )}
      </article>
    </div>
  );
}
