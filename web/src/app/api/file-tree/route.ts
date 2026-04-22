import { connection } from "next/server";
import { getFileTreeWithPdfs } from "@/lib/markdown";

export async function GET() {
  await connection();
  const tree = await getFileTreeWithPdfs();
  return Response.json(tree, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
