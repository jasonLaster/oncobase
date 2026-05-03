import { put } from "@vercel/blob";

const SITE_SLUG_RE = /^[a-z0-9-]{1,32}$/;

export function siteBlobKey(siteSlug: string, key: string) {
  if (!SITE_SLUG_RE.test(siteSlug)) {
    throw new Error(`bad siteSlug: ${siteSlug}`);
  }
  const normalizedKey = key.replace(/^\/+/, "");
  return `sites/${siteSlug}/${normalizedKey}`;
}

export async function sitePut(
  siteSlug: string,
  key: string,
  body: Blob | Buffer | ReadableStream<Uint8Array>,
  options: Omit<Parameters<typeof put>[2], "access"> = {},
) {
  return await put(siteBlobKey(siteSlug, key), body, {
    ...options,
    access: "public",
  });
}

