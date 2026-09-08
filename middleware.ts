export { default } from "./apps/app/.vercel-functions/edge-gate.js";
// Only bypass the gate for literal, flat build assets. Encoded separators and
// dot segments must reach the reserved-namespace check before filesystem routing.
export const config = { runtime: "edge", matcher: ["/((?!assets/[A-Za-z0-9_.-]+$|favicon\\.svg$|robots\\.txt$).*)"] };
