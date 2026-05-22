import { NextResponse } from "next/server";
import { getSessionUserWithAdminFromRequest } from "@/lib/session-user";

export async function GET(request: Request) {
  const user = await getSessionUserWithAdminFromRequest(request);
  return NextResponse.json({ user });
}
