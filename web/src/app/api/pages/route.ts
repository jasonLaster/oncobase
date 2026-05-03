import { connection } from "next/server";
import { getAllPageEntries } from "@/lib/markdown";

export async function GET() {
  await connection();
  const pages = await getAllPageEntries();
  return Response.json(pages, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
