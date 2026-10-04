import { sha256 } from "@noble/hashes/sha2.js";

// Infrequent visits should remain useful: their weight halves every 30 days.
const HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000;

// Log-space sum of exponentially weighted visits. All scores decay at the same
// rate, so an indexed descending sort stays correct without a scheduled job.
export function addVisit(previous: number | undefined, now: number) {
  const visit = now * Math.LN2 / HALF_LIFE_MS;
  if (previous === undefined) return visit;
  const maximum = Math.max(previous, visit);
  return maximum + Math.log(Math.exp(previous - maximum) + Math.exp(visit - maximum));
}

const encoder = new TextEncoder();

/** Legacy shared-secret check (the service JWT replaces it). Compares fixed-
 * length digests in constant time, so neither the secret's contents nor its
 * length is observable through timing. */
export function requirePrefetchSecret(supplied: string | undefined, expected: string | undefined) {
  if (!expected || expected.length < 32 || supplied === undefined) throw new Error("Unauthorized");
  const a = sha256(encoder.encode(supplied));
  const b = sha256(encoder.encode(expected));
  let difference = 0;
  for (let index = 0; index < b.length; index++) difference |= a[index] ^ b[index];
  if (difference !== 0) throw new Error("Unauthorized");
}
