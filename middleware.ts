export { default } from "./apps/app/.vercel-functions/edge-gate.js";
export const config = { runtime: "edge", matcher: ["/((?!assets/|favicon.svg|robots.txt).*)"] };
