import {
  diagnosticComparisonsMetaKeyForSet,
  normalizeDiagnosticComparisonsPayload,
  parseDiagnosticComparisonsPayload,
  type DiagnosticComparisonsPayload,
} from "@/lib/dicom-comparisons";
import { siteDataFromRequest, siteDataFromSlug } from "@/lib/site-data";
import { getRequestSiteSlug } from "@/lib/site";

export async function getDiagnosticComparisonsForRequest(
  request: { headers: Headers },
  comparisonSet?: string | null,
) {
  const siteData = siteDataFromRequest(request);
  return getDiagnosticComparisonsFromSiteData(siteData, comparisonSet);
}

export async function getDiagnosticComparisonsForCurrentSite(
  comparisonSet?: string | null,
) {
  const siteSlug = await getRequestSiteSlug();
  const siteData = siteDataFromSlug(siteSlug);
  return getDiagnosticComparisonsFromSiteData(siteData, comparisonSet);
}

export async function getDiagnosticComparisonsFromSiteData(
  siteData: ReturnType<typeof siteDataFromRequest>,
  comparisonSet?: string | null,
) {
  const value = await siteData.documents.getMeta({
    key: diagnosticComparisonsMetaKeyForSet(comparisonSet),
  });
  return parseDiagnosticComparisonsPayload(value);
}

export async function getDiagnosticComparisonForRequest(
  request: { headers: Headers },
  comparisonId: string,
  comparisonSet?: string | null,
) {
  const comparisons = await getDiagnosticComparisonsForRequest(request, comparisonSet);
  return comparisons.find((comparison) => comparison.id === comparisonId) ?? null;
}

export async function setDiagnosticComparisonsForRequest(
  request: { headers: Headers },
  comparisonSet: string,
  payload: unknown,
) {
  const normalized = normalizeDiagnosticComparisonsPayload(payload);
  const siteData = siteDataFromRequest(request);
  await siteData.documents.setMeta({
    key: diagnosticComparisonsMetaKeyForSet(comparisonSet),
    value: JSON.stringify(normalized),
  });
  return normalized satisfies DiagnosticComparisonsPayload;
}
