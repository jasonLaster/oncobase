import { ConvexHttpClient } from "convex/browser";

let client: ConvexHttpClient | null = null;

export function getConvexServerClient() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  }

  if (!client) {
    client = new ConvexHttpClient(url);
  }

  return client;
}
