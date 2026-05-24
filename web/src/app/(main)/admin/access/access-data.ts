import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { siteDataFromRequest } from "@/lib/site-data";
import { getSessionUserWithAdminFromCookieHeader } from "@/lib/session-user";
import { isSensitiveFrontmatter } from "@/lib/sensitive-pages";

export type AccessRole = {
  _id: string;
  name: string;
  description?: string | null;
  permissions: string[];
  pathPatterns?: string[];
  includePathPatterns?: string[];
  excludePathPatterns?: string[];
  includeTags?: string[];
  excludeTags?: string[];
  emailPatterns?: string[];
};

export type AccessUser = {
  _id: string;
  email: string;
  name: string | null;
  roles: string[];
  roleIds: string[];
};

export type AccessPreviewPage = {
  slug: string;
  title: string;
  tags: string[];
  sensitive?: boolean;
  sourceSensitive?: boolean;
};

export async function getRequestContext() {
  const [cookieStore, requestHeaders] = await Promise.all([
    cookies(),
    headers(),
  ]);
  const headerStore = new Headers(requestHeaders);
  const cookieHeader = cookieStore.toString();
  headerStore.set("cookie", cookieHeader);
  return { cookieHeader, headers: headerStore };
}

export async function requireAdminRequest() {
  const request = await getRequestContext();
  const sessionUser = await getSessionUserWithAdminFromCookieHeader(
    request.cookieHeader,
    request.headers,
  );
  if (!sessionUser?.isAdmin) redirect("/");
  return request;
}

export function normalizeRole(role: AccessRole) {
  return {
    ...role,
    includePathPatterns:
      role.includePathPatterns ?? role.pathPatterns ?? role.permissions ?? [],
    excludePathPatterns: role.excludePathPatterns ?? [],
    includeTags: role.includeTags ?? [],
    excludeTags: role.excludeTags ?? [],
    emailPatterns: role.emailPatterns ?? [],
  };
}

export async function getAccessRoles() {
  const request = await requireAdminRequest();
  const siteData = siteDataFromRequest(request);
  const rawRoles = (await siteData.access.listRoles()) as AccessRole[];
  return rawRoles.map(normalizeRole);
}

export async function getAccessUsersAndRoles() {
  const request = await requireAdminRequest();
  const siteData = siteDataFromRequest(request);
  const [users, rawRoles] = (await Promise.all([
    siteData.access.listUsersWithRoles(),
    siteData.access.listRoles(),
  ])) as [AccessUser[], AccessRole[]];

  return {
    users,
    roles: rawRoles.map(normalizeRole),
  };
}

export async function getAccessPagesData() {
  const request = await requireAdminRequest();
  const siteData = siteDataFromRequest(request);
  const [users, rawRoles, rawPreviewPages] = (await Promise.all([
    siteData.access.listUsersWithRoles(),
    siteData.access.listRoles(),
    siteData.documents.list({ includeSensitive: true }),
  ])) as [AccessUser[], AccessRole[], AccessPreviewPage[]];

  const sourceSensitiveSlugs = readSourceSensitiveSlugs();

  return {
    users,
    roles: rawRoles.map(normalizeRole),
    pages: rawPreviewPages
      .map((page) => ({
        slug: page.slug,
        title: page.title,
        tags: page.tags ?? [],
        sensitive: page.sensitive,
        sourceSensitive: sourceSensitiveSlugs?.has(page.slug),
      }))
      .sort((a, b) => a.slug.localeCompare(b.slug)),
  };
}

function candidateVaultPaths() {
  return [
    process.env.WIKI_VAULT_PATH,
    process.env.OBSIDIAN_VAULT_PATH,
  ].filter((value): value is string => Boolean(value));
}

function readSourceSensitiveSlugs() {
  if (process.env.VERCEL === "1") return null;

  const vaultPath = candidateVaultPaths().find((candidate) =>
    fs.existsSync(candidate),
  );
  if (!vaultPath) return null;

  try {
    return new Set(readSensitiveMarkdownSlugs(vaultPath));
  } catch {
    return null;
  }
}

function readSensitiveMarkdownSlugs(dir: string, basePath = ""): string[] {
  const slugs: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = path.join(dir, entry.name);
    const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      slugs.push(...readSensitiveMarkdownSlugs(fullPath, relativePath));
      continue;
    }

    if (!relativePath.endsWith(".md")) continue;
    const raw = fs.readFileSync(fullPath, "utf8");
    const { data } = matter(raw);
    if (isSensitiveFrontmatter(data as Record<string, unknown>)) {
      slugs.push(relativePath.replace(/\.md$/, ""));
    }
  }

  return slugs;
}
