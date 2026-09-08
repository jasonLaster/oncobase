import type { AuthConfig } from "convex/server";
import { SERVICE_ISSUER, SERVICE_AUDIENCE } from "./lib/serviceAuth";

const jwks = process.env.WIKI_BACKEND_JWKS;
export default {
  // No configured key means no accepted service identity, never an auth bypass.
  providers: jwks ? [{ type: "customJwt", issuer: SERVICE_ISSUER,
    applicationID: SERVICE_AUDIENCE, algorithm: "RS256", jwks }] : [],
} satisfies AuthConfig;
