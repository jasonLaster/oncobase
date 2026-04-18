import { getFileTreeWithPdfs } from "@/lib/markdown";

export async function GET() {
  const tree = await getFileTreeWithPdfs();
  return Response.json(tree, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
