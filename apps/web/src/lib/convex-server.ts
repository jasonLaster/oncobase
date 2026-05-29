import { ConvexHttpClient } from "convex/browser";
import { resolveServerConvexUrl } from "@/lib/convex-url";

let client: ConvexHttpClient | null = null;
let clientUrl: string | null = null;

export function getConvexServerClient() {
  const url = resolveServerConvexUrl();
  if (!url) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  }

  if (!client || clientUrl !== url) {
    client = new ConvexHttpClient(url);
    clientUrl = url;
  }

  return client;
}
