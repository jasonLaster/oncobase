import { handleNextEpicAuthorizeRequest } from "@/lib/epic-fhir-next";

export async function GET(request: Request) {
  return handleNextEpicAuthorizeRequest(request);
}
