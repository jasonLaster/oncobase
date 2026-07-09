// Distinct lazy facade: gives the on-demand comments UI bundle a stable,
// recognizable chunk name (active-comments-*) so the bundle budget can keep
// it out of the eager shell accounting.
export { ActiveDocumentComments as default } from "./index.tsx";
