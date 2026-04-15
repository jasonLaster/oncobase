import { NextResponse } from "next/server";
import { getSessionUserFromRequest } from "@/lib/session-user";

export async function GET(request: Request) {
  const user = await getSessionUserFromRequest(request);
  return NextResponse.json({ user });
}
