import { describe, expect, test } from "bun:test";
import {
  decryptFhirSecret,
  encryptFhirSecret,
  handleEpicSyncRequest,
  normalizeDiagnosticReportResource,
  normalizeObservationResource,
} from "./epic-fhir";

const TEST_KEY = Buffer.alloc(32, 7).toString("base64");

describe("Epic FHIR helpers", () => {
  test("encrypts and decrypts FHIR secrets without returning plaintext", () => {
    const encrypted = encryptFhirSecret("refresh-token", TEST_KEY);
    expect(encrypted.startsWith("v1:")).toBe(true);
    expect(encrypted).not.toContain("refresh-token");
    expect(decryptFhirSecret(encrypted, TEST_KEY)).toBe("refresh-token");
  });

  test("normalizes laboratory Observation resources", () => {
    const normalized = normalizeObservationResource({
      resourceType: "Observation",
      id: "obs-1",
      status: "final",
      category: [{ text: "Laboratory" }],
      code: {
        text: "Hemoglobin",
        coding: [
          {
            system: "http://loinc.org",
            code: "718-7",
            display: "Hemoglobin [Mass/volume] in Blood",
          },
        ],
      },
      effectiveDateTime: "2026-06-22T09:00:00-07:00",
      issued: "2026-06-22T10:00:00-07:00",
      valueQuantity: { value: 11.8, unit: "g/dL" },
      referenceRange: [{ low: { value: 12, unit: "g/dL" }, high: { value: 15.5, unit: "g/dL" } }],
      interpretation: [{ text: "Low" }],
    });

    expect(normalized).toMatchObject({
      resourceType: "Observation",
      fhirId: "obs-1",
      status: "final",
      category: "Laboratory",
      codeText: "Hemoglobin",
      codeSystem: "http://loinc.org",
      code: "718-7",
      valueText: "11.8 g/dL",
      unit: "g/dL",
      referenceRangeText: "12 g/dL-15.5 g/dL",
      interpretation: "Low",
      sortAt: "2026-06-22T10:00:00-07:00",
    });
    expect(normalized?.rawHash.length).toBe(64);
  });

  test("normalizes DiagnosticReport resources", () => {
    const normalized = normalizeDiagnosticReportResource({
      resourceType: "DiagnosticReport",
      id: "report-1",
      status: "final",
      category: [{ text: "LAB" }],
      code: { text: "CBC" },
      effectiveDateTime: "2026-06-22",
      issued: "2026-06-22T11:00:00-07:00",
      conclusion: "CBC resulted.",
    });

    expect(normalized).toMatchObject({
      resourceType: "DiagnosticReport",
      fhirId: "report-1",
      status: "final",
      category: "LAB",
      codeText: "CBC",
      effectiveAt: "2026-06-22",
      issuedAt: "2026-06-22T11:00:00-07:00",
      valueText: "CBC resulted.",
    });
  });

  test("rejects unauthenticated sync requests before reading Epic config", async () => {
    const response = await handleEpicSyncRequest({
      request: new Request("http://127.0.0.1/api/integrations/epic/sync"),
      client: {} as never,
      siteSlug: "diana",
      adminUser: null,
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });
});
