import { pages, educationHref } from "../lib/content.server";
export const dynamic = "force-static";
export default function sitemap() { return [{ url: "https://oncoguide.cc/" }, ...pages.map(page => ({ url: `https://oncoguide.cc${educationHref(page.slug)}/` }))]; }
