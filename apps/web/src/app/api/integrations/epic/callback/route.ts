import { handleNextEpicCallbackRequest } from "@/lib/epic-fhir-next";

export async function GET(request: Request) {
  return handleNextEpicCallbackRequest(request);
}
