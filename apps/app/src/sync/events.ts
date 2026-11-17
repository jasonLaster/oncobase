/** The one sync signal still accepted as a window event. End-to-end tests
 * (e2e/resilience/identity-cache, manifest-polling, journeys/markdown)
 * dispatch it to force a manifest check; `WikiSync` forwards it to the same
 * controller call as the in-app `refresh-manifest` bus event. Everything
 * else in the app uses `reader-bus.ts`. */
export const REFRESH_MANIFEST_EVENT = "wiki-vite:refresh-manifest";
