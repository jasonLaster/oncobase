export const PREFIX = "wiki/education/";
export const DIANA_ORIGIN = "https://diana-tnbc.com";
export type GuidePage = { slug: string; title: string; description?: string; html: string; text: string };
export const educationHref = (slug: string) => `/education/${slug.slice(PREFIX.length)}`;
export const staticAssetHref = (path: string) => `/assets/${path.split("/").map(encodeURIComponent).join("/")}`;
