import { connection } from "next/server";
import { getFileTreeWithPdfs } from "@/lib/markdown";

// `getFileTreeWithPdfs` resolves the active site from the proxy-set
// `x-site-slug` header internally and returns the Convex-backed tree.
export async function GET() {
  await connection();
  const tree = await getFileTreeWithPdfs();
  return Response.json(tree, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
