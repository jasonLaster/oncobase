import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import { Analytics } from "@vercel/analytics/next";
import { CommandPalette, OutlinePalette, ActionPalette } from "@/components/command-palette";
import { ConvexClientProvider } from "@/components/convex-provider";
import "@liveblocks/react-ui/styles.css";
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

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: {
    default: "Diana's TNBC",
    template: "%s — Diana's TNBC",
  },
  description: "Breast cancer research and treatment knowledge base",
  robots: { index: false, follow: false },
  icons: { icon: isDev ? "/favicon-dev.svg" : "/favicon.svg" },
  openGraph: {
    title: "Diana's TNBC",
    description: "Breast cancer research and treatment knowledge base",
    type: "website",
    siteName: "Diana's TNBC",
  },
  twitter: {
    card: "summary",
    title: "Diana's TNBC",
    description: "Breast cancer research and treatment knowledge base",
  },
};

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
      <body className="min-h-full">
        <Script id="theme-init" strategy="beforeInteractive">
          {`(function(){try{var t=localStorage.getItem("theme"),d=window.matchMedia("(prefers-color-scheme:dark)").matches;if(t==="dark"||(t===null&&d))document.documentElement.classList.add("dark")}catch(e){}})()`}
        </Script>
        <ConvexClientProvider>
          {children}
        </ConvexClientProvider>
        <CommandPalette />
        <OutlinePalette />
        <ActionPalette />
        <Analytics />
      </body>
    </html>
  );
}
