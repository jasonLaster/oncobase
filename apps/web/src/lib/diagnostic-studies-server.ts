import {
  diagnosticStudiesMetaKeyForSet,
  normalizeDiagnosticStudiesPayload,
  parseDiagnosticStudiesPayload,
  type DiagnosticStudiesPayload,
} from "@/lib/diagnostic-studies";
import { siteDataFromRequest, siteDataFromSlug } from "@/lib/site-data";
import { getRequestSiteSlug } from "@/lib/site";

export async function getDiagnosticStudiesForRequest(
  request: { headers: Headers },
  studySet?: string | null,
) {
  const siteData = siteDataFromRequest(request);
  return getDiagnosticStudiesFromSiteData(siteData, studySet);
}

export async function getDiagnosticStudiesForCurrentSite(studySet?: string | null) {
  const siteSlug = await getRequestSiteSlug();
  const siteData = siteDataFromSlug(siteSlug);
  return getDiagnosticStudiesFromSiteData(siteData, studySet);
}

export async function getDiagnosticStudiesFromSiteData(
  siteData: ReturnType<typeof siteDataFromRequest>,
  studySet?: string | null,
) {
  const value = await siteData.documents.getMeta({
    key: diagnosticStudiesMetaKeyForSet(studySet),
  });
  return parseDiagnosticStudiesPayload(value);
}

export async function setDiagnosticStudiesForRequest(
  request: { headers: Headers },
  studySet: string,
  payload: unknown,
) {
  const normalized = normalizeDiagnosticStudiesPayload(payload);
  const siteData = siteDataFromRequest(request);
  await siteData.documents.setMeta({
    key: diagnosticStudiesMetaKeyForSet(studySet),
    value: JSON.stringify(normalized),
  });
  return normalized satisfies DiagnosticStudiesPayload;
}
