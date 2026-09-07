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

export function requirePrefetchSecret(supplied: string, expected: string | undefined) {
  if (!expected || expected.length < 32 || supplied.length !== expected.length) throw new Error("Unauthorized");
  let difference = 0;
  for (let index = 0; index < expected.length; index++) difference |= supplied.charCodeAt(index) ^ expected.charCodeAt(index);
  if (difference !== 0) throw new Error("Unauthorized");
}
