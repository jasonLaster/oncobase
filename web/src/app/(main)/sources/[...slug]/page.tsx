import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { cookies, headers } from "next/headers";
import {
  DocumentPage,
  DocumentPageLoading,
  SensitivePageUnavailable,
} from "../../_components/document-page";
import { getSessionUserFromCookieHeader } from "@/lib/session-user";
import { siteDataFromRequest } from "@/lib/site-data";
import { getMarkdownPageMetadata, toNextMetadata } from "@/lib/page-metadata";

export const unstable_instant = {
  prefetch: "static",
  samples: [
    {
      headers: [
        ["x-site-slug", "diana"],
      ],
      cookies: [{ name: "wiki_user_session", value: null }],
      params: { slug: ["trials", "zest-nct05306330"] },
    },
  ],
};

async function sourceRequestContext(slug: string[]) {
  const sourceSlug = `sources/${slug.join("/")}`;
  const [cookieStore, requestHeaders] = await Promise.all([
    cookies(),
    headers(),
  ]);
  const cookieHeader = cookieStore.toString();
  const headerStore = new Headers(requestHeaders);
  headerStore.set("cookie", cookieHeader);
  const request = { headers: headerStore };
  const siteData = siteDataFromRequest(request);
  return { cookieHeader, request, siteData, sourceSlug };
}

async function getSourceAccessState({
  cookieHeader,
  request,
  siteData,
  sourceSlug,
}: Awaited<ReturnType<typeof sourceRequestContext>>) {
  const publicDoc = await siteData.documents.getBySlug({ slug: sourceSlug });
  if (publicDoc) return "public";

  const sensitiveDoc = await siteData.documents.getBySlug({
    slug: sourceSlug,
    includeSensitive: true,
  });
  if (!sensitiveDoc) return "not-found";

  const user = await getSessionUserFromCookieHeader(
    cookieHeader,
    request.headers,
  );
  const canAccess = Boolean(
    user &&
      (await siteData.access.canUserAccessSlug({
        userId: user._id,
        slug: sourceSlug,
      })),
  );
  return canAccess ? "authorized" : "sensitive-unavailable";
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const context = await sourceRequestContext(slug);
  const accessState = await getSourceAccessState(context);
  if (accessState === "not-found") {
    return {
      title: "Not found",
      robots: { index: false, follow: false },
    };
  }
  if (accessState === "sensitive-unavailable") {
    return {
      title: "Private page",
      robots: { index: false, follow: false },
    };
  }

  const page = await getMarkdownPageMetadata(context.sourceSlug, {
    includeSensitive: true,
  });
  return page ? toNextMetadata(page) : {};
}

export default async function SourcePage({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  const { slug } = await params;
  const context = await sourceRequestContext(slug);
  const accessState = await getSourceAccessState(context);
  if (accessState === "not-found") notFound();
  if (accessState === "sensitive-unavailable") {
    return <SensitivePageUnavailable slug={context.sourceSlug} />;
  }

  return (
    <Suspense fallback={<DocumentPageLoading />}>
      <DocumentPage params={Promise.resolve({ slug: context.sourceSlug.split("/") })} />
    </Suspense>
  );
}
