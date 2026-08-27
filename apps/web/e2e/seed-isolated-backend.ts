import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { testConvexUrl } from "./test-environment";

const LOCAL_GATE_PASSWORD_HASH =
  "sha256:1b2fc9341a16ae4e30082965d537ae47c21a0f27fd43eab78330ed81751ae6db";

const convexUrl = testConvexUrl();
if (!convexUrl) {
  throw new Error(
    "PLAYWRIGHT_TEST_CONVEX_URL is required to seed the isolated test backend.",
  );
}

const convex = new ConvexHttpClient(convexUrl);
await convex.mutation(api.sites.ensureDiana, {
  domain: "localhost",
  passwordHash: LOCAL_GATE_PASSWORD_HASH,
});
