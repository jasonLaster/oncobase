import crypto from "node:crypto";
import type { ConvexHttpClient } from "convex/browser";
import { api } from "../../../apps/web/convex/_generated/api.js";
import type { Id } from "../../../apps/web/convex/_generated/dataModel.js";

const DEFAULT_PROVIDER_KEY = "ucsf";
const DEFAULT_PROVIDER_NAME = "UCSF Health Epic";
const DEFAULT_FHIR_BASE_URL =
  "https://unified-api.ucsf.edu/clinical/apex/api/FHIR/R4";
const DEFAULT_SCOPES = [
  "launch/patient",
  "openid",
  "fhirUser",
  "offline_access",
  "patient/Patient.read",
  "patient/Observation.read",
  "patient/DiagnosticReport.read",
  "patient/DocumentReference.read",
  "patient/Binary.read",
];
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_INITIAL_LOOKBACK_DAYS = 180;
const MAX_BUNDLE_PAGES = 20;

type SessionUser = {
  _id: Id<"users">;
  email: string;
  name?: string | null;
};

type SmartConfiguration = {
  authorization_endpoint?: string;
  token_endpoint?: string;
};

type EpicProviderConfig = {
  providerKey: string;
  providerName: string;
  fhirBaseUrl: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  clientId: string;
  clientSecret?: string;
  scopes: string[];
};

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  patient?: string;
  scope?: string;
  error?: string;
  error_description?: string;
};

type EpicSyncTarget = {
  _id: Id<"epicFhirConnections">;
  providerKey: string;
  providerName: string;
  fhirBaseUrl: string;
  tokenEndpoint: string;
  patientIdCiphertext?: string;
  accessTokenCiphertext?: string;
  refreshTokenCiphertext?: string;
  tokenExpiresAt?: number;
  lastObservationIssuedAt?: string;
  lastDiagnosticReportDate?: string;
};

type FhirCoding = {
  system?: string;
  code?: string;
  display?: string;
};

type FhirCodeableConcept = {
  text?: string;
  coding?: FhirCoding[];
};

type FhirResource = {
  resourceType?: string;
  id?: string;
  status?: string;
  category?: FhirCodeableConcept[];
  code?: FhirCodeableConcept;
  effectiveDateTime?: string;
  effectiveInstant?: string;
  effectivePeriod?: { start?: string; end?: string };
  issued?: string;
  valueQuantity?: { value?: number; unit?: string; code?: string };
  valueString?: string;
  valueCodeableConcept?: FhirCodeableConcept;
  valueBoolean?: boolean;
  valueInteger?: number;
  component?: Array<{
    code?: FhirCodeableConcept;
    valueQuantity?: { value?: number; unit?: string; code?: string };
    valueString?: string;
    valueCodeableConcept?: FhirCodeableConcept;
    valueBoolean?: boolean;
    valueInteger?: number;
  }>;
  referenceRange?: Array<{
    text?: string;
    low?: { value?: number; unit?: string };
    high?: { value?: number; unit?: string };
  }>;
  interpretation?: FhirCodeableConcept[];
  conclusion?: string;
  result?: Array<{ reference?: string; display?: string }>;
  presentedForm?: Array<{ title?: string; contentType?: string; url?: string }>;
};

type FhirBundle = {
  resourceType?: "Bundle";
  entry?: Array<{ resource?: FhirResource }>;
  link?: Array<{ relation?: string; url?: string }>;
};

export type NormalizedLabResult = {
  resourceType: string;
  fhirId: string;
  status?: string;
  category?: string;
  codeText?: string;
  codeSystem?: string;
  code?: string;
  effectiveAt?: string;
  issuedAt?: string;
  sortAt: string;
  valueText?: string;
  unit?: string;
  referenceRangeText?: string;
  interpretation?: string;
  rawHash: string;
  rawJson: string;
};

function withSiteSlug<TArgs extends object>(
  siteSlug: string,
  args: TArgs,
): TArgs & { siteSlug: string } {
  return { ...args, siteSlug };
}

function envValue(name: string) {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function ensureTrailingSlash(value: string) {
  return value.endsWith("/") ? value : `${value}/`;
}

function splitScopes(value: string | undefined) {
  return (value ?? DEFAULT_SCOPES.join(" "))
    .split(/\s+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
}

function sha256Hex(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function base64Url(buffer: Buffer) {
  return buffer.toString("base64url");
}

function timingSafeStringEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function keyFromInput(input = envValue("EPIC_FHIR_TOKEN_ENCRYPTION_KEY")) {
  if (!input) {
    throw new Error("EPIC_FHIR_TOKEN_ENCRYPTION_KEY is not set");
  }

  if (/^[0-9a-f]{64}$/i.test(input)) {
    return Buffer.from(input, "hex");
  }

  const base64 = Buffer.from(input, "base64");
  if (base64.length === 32) return base64;

  return crypto.createHash("sha256").update(input).digest();
}

export function encryptFhirSecret(plaintext: string, keyInput?: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyFromInput(keyInput), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `v1:${base64Url(iv)}:${base64Url(tag)}:${base64Url(ciphertext)}`;
}

export function decryptFhirSecret(payload: string, keyInput?: string) {
  const [version, iv, tag, ciphertext] = payload.split(":");
  if (version !== "v1" || !iv || !tag || !ciphertext) {
    throw new Error("Unsupported encrypted FHIR payload");
  }
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    keyFromInput(keyInput),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function createPkcePair() {
  const verifier = base64Url(crypto.randomBytes(32));
  const challenge = base64Url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

async function getSmartConfiguration(fhirBaseUrl: string): Promise<SmartConfiguration> {
  const url = new URL(".well-known/smart-configuration", ensureTrailingSlash(fhirBaseUrl));
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`Unable to read SMART configuration (${response.status})`);
  }
  return (await response.json()) as SmartConfiguration;
}

async function getEpicProviderConfig(): Promise<EpicProviderConfig> {
  const clientId = envValue("EPIC_FHIR_CLIENT_ID");
  if (!clientId) throw new Error("EPIC_FHIR_CLIENT_ID is not set");

  const fhirBaseUrl = envValue("EPIC_FHIR_BASE_URL") ?? DEFAULT_FHIR_BASE_URL;
  const smart = await getSmartConfiguration(fhirBaseUrl);
  const authorizationEndpoint =
    envValue("EPIC_FHIR_AUTHORIZATION_ENDPOINT") ?? smart.authorization_endpoint;
  const tokenEndpoint = envValue("EPIC_FHIR_TOKEN_ENDPOINT") ?? smart.token_endpoint;
  if (!authorizationEndpoint || !tokenEndpoint) {
    throw new Error("Epic SMART configuration is missing authorization or token endpoints");
  }

  return {
    providerKey: envValue("EPIC_FHIR_PROVIDER_KEY") ?? DEFAULT_PROVIDER_KEY,
    providerName: envValue("EPIC_FHIR_PROVIDER_NAME") ?? DEFAULT_PROVIDER_NAME,
    fhirBaseUrl,
    authorizationEndpoint,
    tokenEndpoint,
    clientId,
    clientSecret: envValue("EPIC_FHIR_CLIENT_SECRET"),
    scopes: splitScopes(envValue("EPIC_FHIR_SCOPES")),
  };
}

function configuredRedirectUri(request: Request) {
  const override = envValue("EPIC_FHIR_REDIRECT_URI");
  if (override) return override;
  return new URL("/api/integrations/epic/callback", request.url).toString();
}

function createAuthorizeUrl(
  config: EpicProviderConfig,
  redirectUri: string,
  state: string,
  codeChallenge: string,
) {
  const url = new URL(config.authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", config.scopes.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("aud", config.fhirBaseUrl);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url;
}

async function exchangeToken(
  tokenEndpoint: string,
  body: Record<string, string>,
): Promise<TokenResponse> {
  const response = await fetch(tokenEndpoint, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body),
  });
  const payload = (await response.json().catch(() => ({}))) as TokenResponse;
  if (!response.ok || payload.error) {
    throw new Error(
      payload.error_description ||
        payload.error ||
        `Epic token exchange failed (${response.status})`,
    );
  }
  return payload;
}

async function exchangeCodeForToken(
  config: Pick<EpicProviderConfig, "clientId" | "clientSecret"> & {
    tokenEndpoint: string;
  },
  code: string,
  redirectUri: string,
  codeVerifier: string,
) {
  return exchangeToken(config.tokenEndpoint, {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: config.clientId,
    code_verifier: codeVerifier,
    ...(config.clientSecret ? { client_secret: config.clientSecret } : {}),
  });
}

async function refreshAccessToken(
  config: Pick<EpicProviderConfig, "clientId" | "clientSecret"> & {
    tokenEndpoint: string;
  },
  refreshToken: string,
) {
  return exchangeToken(config.tokenEndpoint, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: config.clientId,
    ...(config.clientSecret ? { client_secret: config.clientSecret } : {}),
  });
}

function firstCoding(concept: FhirCodeableConcept | undefined) {
  return concept?.coding?.find((coding) => coding.code || coding.display);
}

function conceptText(concept: FhirCodeableConcept | undefined) {
  return concept?.text || firstCoding(concept)?.display || firstCoding(concept)?.code;
}

function quantityText(quantity: { value?: number; unit?: string; code?: string } | undefined) {
  if (!quantity || quantity.value == null) return undefined;
  return [String(quantity.value), quantity.unit ?? quantity.code]
    .filter(Boolean)
    .join(" ");
}

function componentValueText(component: NonNullable<FhirResource["component"]>[number]) {
  return (
    quantityText(component.valueQuantity) ??
    component.valueString ??
    conceptText(component.valueCodeableConcept) ??
    (typeof component.valueBoolean === "boolean" ? String(component.valueBoolean) : undefined) ??
    (typeof component.valueInteger === "number" ? String(component.valueInteger) : undefined)
  );
}

function valueText(resource: FhirResource) {
  const direct =
    quantityText(resource.valueQuantity) ??
    resource.valueString ??
    conceptText(resource.valueCodeableConcept) ??
    (typeof resource.valueBoolean === "boolean" ? String(resource.valueBoolean) : undefined) ??
    (typeof resource.valueInteger === "number" ? String(resource.valueInteger) : undefined);
  if (direct) return direct;

  const components = resource.component
    ?.map((component) => {
      const label = conceptText(component.code);
      const value = componentValueText(component);
      return label && value ? `${label}: ${value}` : value;
    })
    .filter(Boolean);
  return components?.length ? components.join("; ") : undefined;
}

function referenceRangeText(resource: FhirResource) {
  return resource.referenceRange
    ?.map((range) => {
      if (range.text) return range.text;
      const low = range.low?.value == null ? "" : `${range.low.value}${range.low.unit ? ` ${range.low.unit}` : ""}`;
      const high = range.high?.value == null ? "" : `${range.high.value}${range.high.unit ? ` ${range.high.unit}` : ""}`;
      if (low && high) return `${low}-${high}`;
      return low || high;
    })
    .filter(Boolean)
    .join("; ");
}

function firstCategory(resource: FhirResource) {
  return resource.category?.map(conceptText).filter(Boolean).join("; ");
}

function effectiveAt(resource: FhirResource) {
  return (
    resource.effectiveDateTime ??
    resource.effectiveInstant ??
    resource.effectivePeriod?.start ??
    resource.effectivePeriod?.end
  );
}

function sortAt(resource: FhirResource) {
  return resource.issued ?? effectiveAt(resource) ?? "";
}

function rawJsonAndHash(resource: FhirResource) {
  const rawJson = JSON.stringify(resource);
  return { rawJson, rawHash: sha256Hex(rawJson) };
}

export function normalizeObservationResource(
  resource: FhirResource,
): NormalizedLabResult | null {
  if (resource.resourceType !== "Observation" || !resource.id) return null;
  const coding = firstCoding(resource.code);
  const { rawJson, rawHash } = rawJsonAndHash(resource);
  return {
    resourceType: "Observation",
    fhirId: resource.id,
    status: resource.status,
    category: firstCategory(resource),
    codeText: conceptText(resource.code),
    codeSystem: coding?.system,
    code: coding?.code,
    effectiveAt: effectiveAt(resource),
    issuedAt: resource.issued,
    sortAt: sortAt(resource),
    valueText: valueText(resource),
    unit: resource.valueQuantity?.unit ?? resource.valueQuantity?.code,
    referenceRangeText: referenceRangeText(resource),
    interpretation: resource.interpretation?.map(conceptText).filter(Boolean).join("; "),
    rawHash,
    rawJson,
  };
}

export function normalizeDiagnosticReportResource(
  resource: FhirResource,
): NormalizedLabResult | null {
  if (resource.resourceType !== "DiagnosticReport" || !resource.id) return null;
  const coding = firstCoding(resource.code);
  const { rawJson, rawHash } = rawJsonAndHash(resource);
  const resultText = resource.result?.map((result) => result.display ?? result.reference).filter(Boolean).join("; ");
  const formText = resource.presentedForm
    ?.map((form) => form.title ?? form.contentType ?? form.url)
    .filter(Boolean)
    .join("; ");
  return {
    resourceType: "DiagnosticReport",
    fhirId: resource.id,
    status: resource.status,
    category: firstCategory(resource),
    codeText: conceptText(resource.code),
    codeSystem: coding?.system,
    code: coding?.code,
    effectiveAt: effectiveAt(resource),
    issuedAt: resource.issued,
    sortAt: sortAt(resource),
    valueText: resource.conclusion ?? resultText ?? formText,
    rawHash,
    rawJson,
  };
}

function latestIso(values: Array<string | undefined>) {
  let latest: string | undefined;
  let latestTime = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (!value) continue;
    const time = Date.parse(value);
    if (Number.isNaN(time)) continue;
    if (time > latestTime) {
      latestTime = time;
      latest = value;
    }
  }
  return latest;
}

function initialWatermark() {
  const days = Number(envValue("EPIC_FHIR_INITIAL_LOOKBACK_DAYS") ?? DEFAULT_INITIAL_LOOKBACK_DAYS);
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

async function fetchFhirBundlePages(
  fhirBaseUrl: string,
  accessToken: string,
  resourceType: "Observation" | "DiagnosticReport",
  searchParams: Record<string, string>,
) {
  const resources: FhirResource[] = [];
  let nextUrl: string | null = new URL(resourceType, ensureTrailingSlash(fhirBaseUrl)).toString();
  let pages = 0;

  while (nextUrl && pages < MAX_BUNDLE_PAGES) {
    const url = new URL(nextUrl);
    if (pages === 0) {
      for (const [key, value] of Object.entries(searchParams)) {
        url.searchParams.set(key, value);
      }
    }

    const response = await fetch(url, {
      headers: {
        Accept: "application/fhir+json, application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (!response.ok) {
      throw new Error(`${resourceType} search failed (${response.status})`);
    }

    const bundle = (await response.json()) as FhirBundle;
    for (const entry of bundle.entry ?? []) {
      if (entry.resource) resources.push(entry.resource);
    }
    nextUrl =
      bundle.link?.find((link) => link.relation === "next" && link.url)?.url ?? null;
    pages++;
  }

  return resources;
}

async function syncConnection(
  client: ConvexHttpClient,
  siteSlug: string,
  config: EpicProviderConfig,
  connection: EpicSyncTarget,
) {
  if (!connection.refreshTokenCiphertext || !connection.patientIdCiphertext) {
    throw new Error("Epic connection is missing refresh token or patient context");
  }

  await client.mutation(
    api.epicFhir.markSyncStarted,
    withSiteSlug(siteSlug, { connectionId: connection._id }),
  );

  const refreshToken = decryptFhirSecret(connection.refreshTokenCiphertext);
  const refreshed = await refreshAccessToken(
    {
      tokenEndpoint: connection.tokenEndpoint,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
    },
    refreshToken,
  );
  if (!refreshed.access_token) throw new Error("Epic refresh did not return an access token");

  const accessToken = refreshed.access_token;
  const nextRefreshToken = refreshed.refresh_token ?? refreshToken;
  const patientId = decryptFhirSecret(connection.patientIdCiphertext);
  const observationWatermark = connection.lastObservationIssuedAt ?? initialWatermark();
  const reportWatermark = connection.lastDiagnosticReportDate ?? initialWatermark();

  const [observations, reports] = await Promise.all([
    fetchFhirBundlePages(connection.fhirBaseUrl, accessToken, "Observation", {
      patient: patientId,
      category: "laboratory",
      issued: `ge${observationWatermark}`,
      _count: "100",
    }),
    fetchFhirBundlePages(connection.fhirBaseUrl, accessToken, "DiagnosticReport", {
      patient: patientId,
      date: `ge${reportWatermark}`,
      _count: "100",
    }),
  ]);

  const normalized = [
    ...observations.map(normalizeObservationResource),
    ...reports.map(normalizeDiagnosticReportResource),
  ].filter((result): result is NormalizedLabResult => result != null);

  let created = 0;
  for (const result of normalized) {
    const response = await client.mutation(
      api.epicFhir.upsertLabResult,
      withSiteSlug(siteSlug, {
        connectionId: connection._id,
        resourceType: result.resourceType,
        fhirId: result.fhirId,
        status: result.status,
        category: result.category,
        codeText: result.codeText,
        codeSystem: result.codeSystem,
        code: result.code,
        effectiveAt: result.effectiveAt,
        issuedAt: result.issuedAt,
        sortAt: result.sortAt,
        valueText: result.valueText,
        unit: result.unit,
        referenceRangeText: result.referenceRangeText,
        interpretation: result.interpretation,
        rawHash: result.rawHash,
        rawJsonCiphertext: encryptFhirSecret(result.rawJson),
      }),
    );
    if (response?.created) created++;
  }

  const latestObservationIssuedAt = latestIso(
    observations.map((resource) => resource.issued ?? effectiveAt(resource)),
  );
  const latestDiagnosticReportDate = latestIso(
    reports.map((resource) => effectiveAt(resource) ?? resource.issued),
  );
  const tokenExpiresAt =
    typeof refreshed.expires_in === "number"
      ? Date.now() + refreshed.expires_in * 1000
      : connection.tokenExpiresAt;

  await client.mutation(
    api.epicFhir.markSyncComplete,
    withSiteSlug(siteSlug, {
      connectionId: connection._id,
      accessTokenCiphertext: encryptFhirSecret(accessToken),
      refreshTokenCiphertext: encryptFhirSecret(nextRefreshToken),
      tokenExpiresAt,
      lastObservationIssuedAt:
        latestObservationIssuedAt ?? connection.lastObservationIssuedAt,
      lastDiagnosticReportDate:
        latestDiagnosticReportDate ?? connection.lastDiagnosticReportDate,
    }),
  );

  return {
    connectionId: connection._id,
    providerKey: connection.providerKey,
    observations: observations.length,
    diagnosticReports: reports.length,
    upserted: normalized.length,
    created,
  };
}

export async function isAdminSessionUser(
  client: ConvexHttpClient,
  siteSlug: string,
  user: SessionUser | null,
) {
  if (!user) return false;
  const site = await client.query(api.sites.getBySlug, { slug: siteSlug });
  if (site?.ownerEmail?.toLowerCase() === user.email.toLowerCase()) return true;
  const users = await client.query(
    api.access.listUsersWithRoles,
    withSiteSlug(siteSlug, {}),
  ).catch(() => []);
  const userWithRoles = users.find((item: { _id: string }) => item._id === user._id);
  return Boolean(
    userWithRoles?.roles?.some(
      (role: string) => role.trim().toLowerCase() === "admin",
    ),
  );
}

export async function handleEpicAuthorizeRequest({
  request,
  client,
  siteSlug,
  adminUser,
}: {
  request: Request;
  client: ConvexHttpClient;
  siteSlug: string;
  adminUser: SessionUser | null;
}) {
  if (request.method !== "GET") {
    return Response.json(
      { error: "Method not allowed" },
      { status: 405, headers: { Allow: "GET" } },
    );
  }
  if (!adminUser) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const config = await getEpicProviderConfig();
  const redirectUri = configuredRedirectUri(request);
  const state = base64Url(crypto.randomBytes(32));
  const { verifier, challenge } = createPkcePair();
  await client.mutation(
    api.epicFhir.createOAuthState,
    withSiteSlug(siteSlug, {
      providerKey: config.providerKey,
      stateHash: sha256Hex(state),
      redirectUri,
      codeVerifierCiphertext: encryptFhirSecret(verifier),
      fhirBaseUrl: config.fhirBaseUrl,
      authorizationEndpoint: config.authorizationEndpoint,
      tokenEndpoint: config.tokenEndpoint,
      scopes: config.scopes,
      expiresAt: Date.now() + OAUTH_STATE_TTL_MS,
      userId: adminUser._id,
    }),
  );

  return Response.redirect(
    createAuthorizeUrl(config, redirectUri, state, challenge).toString(),
    302,
  );
}

export async function handleEpicCallbackRequest({
  request,
  client,
  siteSlug,
}: {
  request: Request;
  client: ConvexHttpClient;
  siteSlug: string;
}) {
  if (request.method !== "GET") {
    return Response.json(
      { error: "Method not allowed" },
      { status: 405, headers: { Allow: "GET" } },
    );
  }

  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  if (error) {
    return Response.json(
      { error, errorDescription: url.searchParams.get("error_description") },
      { status: 400 },
    );
  }

  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (!state || !code) {
    return Response.json({ error: "Missing Epic OAuth state or code" }, { status: 400 });
  }

  const stateRecord = await client.mutation(
    api.epicFhir.consumeOAuthState,
    withSiteSlug(siteSlug, { stateHash: sha256Hex(state) }),
  );
  if (!stateRecord) {
    return Response.json({ error: "Invalid or expired Epic OAuth state" }, { status: 400 });
  }

  const config = await getEpicProviderConfig();
  const codeVerifier = decryptFhirSecret(stateRecord.codeVerifierCiphertext);
  const token = await exchangeCodeForToken(
    {
      tokenEndpoint: stateRecord.tokenEndpoint,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
    },
    code,
    stateRecord.redirectUri,
    codeVerifier,
  );
  if (!token.access_token || !token.refresh_token || !token.patient) {
    return Response.json(
      { error: "Epic did not return patient context and refresh credentials" },
      { status: 502 },
    );
  }

  await client.mutation(
    api.epicFhir.upsertConnection,
    withSiteSlug(siteSlug, {
      providerKey: stateRecord.providerKey,
      providerName: config.providerName,
      fhirBaseUrl: stateRecord.fhirBaseUrl,
      authorizationEndpoint: stateRecord.authorizationEndpoint,
      tokenEndpoint: stateRecord.tokenEndpoint,
      patientIdCiphertext: encryptFhirSecret(token.patient),
      scopes: token.scope ? splitScopes(token.scope) : stateRecord.scopes,
      accessTokenCiphertext: encryptFhirSecret(token.access_token),
      refreshTokenCiphertext: encryptFhirSecret(token.refresh_token),
      tokenExpiresAt:
        typeof token.expires_in === "number"
          ? Date.now() + token.expires_in * 1000
          : undefined,
      userId: stateRecord.userId,
    }),
  );

  return Response.redirect(new URL("/?epic=connected", request.url).toString(), 302);
}

function requestHasSyncSecret(request: Request) {
  const secret = envValue("EPIC_FHIR_SYNC_SECRET") ?? envValue("CRON_SECRET");
  if (!secret) return false;
  const authorization = request.headers.get("authorization") ?? "";
  const providedBearer = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";
  const providedQuery = new URL(request.url).searchParams.get("secret") ?? "";
  return (
    (providedBearer && timingSafeStringEqual(providedBearer, secret)) ||
    (providedQuery && timingSafeStringEqual(providedQuery, secret))
  );
}

export async function handleEpicSyncRequest({
  request,
  client,
  siteSlug,
  adminUser,
}: {
  request: Request;
  client: ConvexHttpClient;
  siteSlug: string;
  adminUser: SessionUser | null;
}) {
  if (request.method !== "GET" && request.method !== "POST") {
    return Response.json(
      { error: "Method not allowed" },
      { status: 405, headers: { Allow: "GET, POST" } },
    );
  }
  if (!requestHasSyncSecret(request) && !adminUser) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const config = await getEpicProviderConfig();
  const connections = (await client.query(
    api.epicFhir.listSyncTargets,
    withSiteSlug(siteSlug, {}),
  )) as EpicSyncTarget[];

  const results = [];
  const errors = [];
  for (const connection of connections) {
    try {
      results.push(await syncConnection(client, siteSlug, config, connection));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push({ connectionId: connection._id, providerKey: connection.providerKey, error: message });
      await client.mutation(
        api.epicFhir.markSyncError,
        withSiteSlug(siteSlug, {
          connectionId: connection._id,
          error: message,
        }),
      ).catch(() => undefined);
    }
  }

  return Response.json(
    {
      ok: errors.length === 0,
      connections: connections.length,
      results,
      errors,
    },
    {
      status: errors.length ? 207 : 200,
      headers: { "Cache-Control": "private, no-store" },
    },
  );
}
