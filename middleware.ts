// Generated from the same reader as the Node fallback during the app build.
export { default } from "./apps/app/.vercel-functions/edge-reader.js";

export const config = {
  runtime: "edge",
  matcher: ["/((?!api/|assets/|favicon.svg|robots.txt).*)"],
};
