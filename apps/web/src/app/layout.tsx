import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { Toaster } from "sonner";
import { Suspense } from "react";
import { CommandPalette, OutlinePalette, ActionPalette } from "@/components/command-palette";
import { ConvexClientProvider } from "@/components/convex-provider";
import { ServiceWorkerRegistration } from "@/components/service-worker-registration";
import { getCompactFileTreeForSite } from "@/lib/markdown";
import { getSessionUserFromCookieHeader } from "@/lib/session-user";
import { DEFAULT_SITE_SLUG, toSiteSlug } from "@/lib/site";
import "@liveblocks/react-ui/styles.css";
import "katex/dist/katex.min.css";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const isDev = process.env.NODE_ENV === "development";

const themeInitScript = `(function(){try{var t=localStorage.getItem("theme");var d=window.matchMedia("(prefers-color-scheme: dark)").matches;if(t==="dark"||(t===null&&d)){document.documentElement.classList.add("dark");document.documentElement.style.colorScheme="dark"}else{document.documentElement.classList.remove("dark");document.documentElement.style.colorScheme="light"}}catch(e){}})();`;
const sidebarInitScript = `(function(){try{var w=localStorage.getItem("sidebar-width");document.documentElement.dataset.initialSidebarState=w==="0"?"collapsed":"expanded"}catch(e){}})();`;

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: {
    default: "TNBC Knowledge Base",
    template: "%s — TNBC Knowledge Base",
  },
  description: "Breast cancer research and treatment knowledge base",
  robots: { index: false, follow: false },
  icons: { icon: isDev ? "/favicon-dev.svg" : "/favicon.svg" },
  openGraph: {
    title: "TNBC Knowledge Base",
    description: "Breast cancer research and treatment knowledge base",
    type: "website",
    siteName: "TNBC Knowledge Base",
  },
  twitter: {
    card: "summary",
    title: "TNBC Knowledge Base",
    description: "Breast cancer research and treatment knowledge base",
  },
};

async function CommandPaletteBootstrap() {
  const headerStore = await headers();
  const siteSlug = toSiteSlug(
    headerStore.get("x-site-slug") ?? DEFAULT_SITE_SLUG,
  );
  const includeSensitive = Boolean(
    await getSessionUserFromCookieHeader(
      headerStore.get("cookie") ?? "",
      headerStore,
    ),
  );
  const initialCompactTree = await getCompactFileTreeForSite(siteSlug, {
    includeSensitive,
  });

  return <CommandPalette initialCompactTree={initialCompactTree} />;
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <script dangerouslySetInnerHTML={{ __html: sidebarInitScript }} />
      </head>
      <body className="min-h-full">
        <ConvexClientProvider>{children}</ConvexClientProvider>
        <Suspense fallback={<CommandPalette />}>
          <CommandPaletteBootstrap />
        </Suspense>
        <OutlinePalette />
        <ActionPalette />
        <Toaster richColors closeButton position="bottom-right" theme="system" />
        <Analytics />
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
