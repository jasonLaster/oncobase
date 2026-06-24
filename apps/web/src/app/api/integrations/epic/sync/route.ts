import { handleNextEpicSyncRequest } from "@/lib/epic-fhir-next";

export async function GET(request: Request) {
  return handleNextEpicSyncRequest(request);
}

export async function POST(request: Request) {
  return handleNextEpicSyncRequest(request);
}
