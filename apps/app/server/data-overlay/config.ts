import { DEFAULT_DATA_OVERLAY_ORIGIN } from "./host";

type Env = Record<string, string | undefined>;

export const DEFAULT_MAIN_ORIGIN = "https://diana-tnbc.com";
export const DEFAULT_DATA_SITE_SLUG = "diana";
export const DEFAULT_AWS_REGION = "us-east-1";

export type DataOverlayConfig = {
  /** https://data.diana-tnbc.com */
  dataOrigin: string;
  /** https://diana-tnbc.com: where visitors sign in. */
  mainOrigin: string;
  /** The wiki site whose accounts and roles apply. */
  siteSlug: string;
  /** HMAC key for the sign-in handoff; null disables browser sign-in. */
  handoffSecret: string | null;
  secureCookies: boolean;
};

export type DataOverlayS3Config = {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
};

function origin(value: string | undefined, fallback: string) {
  try { return new URL(value?.trim() || fallback).origin; }
  catch { return new URL(fallback).origin; }
}

export function dataOverlayConfigFromEnv(env: Env = process.env): DataOverlayConfig {
  const dataOrigin = origin(env.DATA_OVERLAY_ORIGIN, DEFAULT_DATA_OVERLAY_ORIGIN);
  return {
    dataOrigin,
    mainOrigin: origin(env.DATA_OVERLAY_MAIN_ORIGIN, DEFAULT_MAIN_ORIGIN),
    siteSlug: env.DATA_OVERLAY_SITE_SLUG?.trim() || DEFAULT_DATA_SITE_SLUG,
    handoffSecret: env.DATA_OVERLAY_HANDOFF_SECRET?.trim() || null,
    secureCookies: dataOrigin.startsWith("https:"),
  };
}

/** S3 settings, or null when any is missing. The overlay never falls back
 * to the default AWS credential chain, so it cannot pick up unrelated
 * credentials from the deployment's environment. */
export function dataOverlayS3ConfigFromEnv(env: Env = process.env): DataOverlayS3Config | null {
  const bucket = env.DATA_OVERLAY_S3_BUCKET?.trim();
  const accessKeyId = env.DATA_OVERLAY_AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.DATA_OVERLAY_AWS_SECRET_ACCESS_KEY?.trim();
  if (!bucket || !accessKeyId || !secretAccessKey) return null;
  return { bucket, region: env.DATA_OVERLAY_AWS_REGION?.trim() || DEFAULT_AWS_REGION, accessKeyId, secretAccessKey };
}
