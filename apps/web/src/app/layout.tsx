import type { Metadata, Viewport } from "next";

const isDev = process.env.NODE_ENV === "development";

const themeInitScript = `(function(){try{var t=localStorage.getItem("theme");var d=window.matchMedia("(prefers-color-scheme: dark)").matches;if(t==="dark"||(t===null&&d)){document.documentElement.classList.add("dark");document.documentElement.style.colorScheme="dark"}else{document.documentElement.classList.remove("dark");document.documentElement.style.colorScheme="light"}}catch(e){}})();`;
const sidebarInitScript = `(function(){try{var w=localStorage.getItem("sidebar-width");document.documentElement.dataset.initialSidebarState=w==="0"?"collapsed":"expanded"}catch(e){}})();`;
const rootStyle = `:root{--background:#fff;--foreground:#1a1a2e}.dark{--background:#0f0f1a;--foreground:#e5e5e5}*{box-sizing:border-box}html{min-height:100%;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}body{min-height:100vh;margin:0;background:var(--background);color:var(--foreground);font-family:ui-sans-serif,system-ui,sans-serif}button,input{font:inherit}@media (min-width:768px){html[data-initial-sidebar-state=collapsed] [data-sidebar-collapsed-rail]{display:flex!important}html[data-initial-sidebar-state=collapsed] [data-sidebar-expanded-rail]{display:none!important}}.auth-page{min-height:100vh;min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:1rem;background:#f9fafb}.auth-card{width:100%;max-width:24rem;padding:2rem;border-radius:.5rem;background:#fff;box-shadow:0 4px 6px -1px rgb(0 0 0/.1),0 2px 4px -2px rgb(0 0 0/.1)}.auth-title{margin:0 0 1.5rem;color:#111827;font-size:1.25rem;line-height:1.75rem;font-weight:600;text-align:center}.auth-input{width:100%;margin-bottom:1rem;padding:.5rem 1rem;border:1px solid #d1d5db;border-radius:.375rem;color:#111827;background:#fff;outline:none}.auth-input:focus{border-color:#3b82f6;box-shadow:0 0 0 2px #3b82f6}.auth-error{margin:0 0 1rem;color:#ef4444;font-size:.875rem;line-height:1.25rem}.auth-button{width:100%;padding:.5rem 1rem;border:0;border-radius:.375rem;color:#fff;background:#2563eb;cursor:pointer;transition:background-color 150ms ease}.auth-button:hover{background:#1d4ed8}`;

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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <style>{rootStyle}</style>
        <script id="theme-init">{themeInitScript}</script>
        <script id="sidebar-init">{sidebarInitScript}</script>
      </head>
      <body className="min-h-full">
        {children}
      </body>
    </html>
  );
}
