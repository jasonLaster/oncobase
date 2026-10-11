import { pages, educationHref } from "../lib/content.server";
export const dynamic = "force-static";
export default function sitemap() { return [{ url: "https://oncoguide.cc/" }, { url: "https://oncoguide.cc/education/chat/" }, ...pages.map(page => ({ url: `https://oncoguide.cc${educationHref(page.slug)}/` }))]; }
