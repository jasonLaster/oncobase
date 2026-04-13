import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { CommandPalette } from "@/components/command-palette";
import { ConvexClientProvider } from "@/components/convex-provider";
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

export const metadata: Metadata = {
  title: "Diana's TNBC",
  description: "Breast cancer research and treatment knowledge base",
  robots: { index: false, follow: false },
  icons: { icon: isDev ? "/favicon-dev.svg" : "/favicon.svg" },
  openGraph: {
    title: "Diana's TNBC",
    description: "Breast cancer research and treatment knowledge base",
    type: "website",
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
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("theme"),d=window.matchMedia("(prefers-color-scheme:dark)").matches;if(t==="dark"||(t===null&&d))document.documentElement.classList.add("dark")}catch(e){}})()`,
          }}
        />
      </head>
      <body className="min-h-full">
        <ConvexClientProvider>
          {children}
        </ConvexClientProvider>
        <CommandPalette />
        <Analytics />
      </body>
    </html>
  );
}
