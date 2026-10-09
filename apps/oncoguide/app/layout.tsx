import type { Metadata } from "next";
import type { ReactNode } from "react";
import { EducationFrame } from "../components/education-frame";
import { navigation } from "../lib/content.server";
import "./styles.css";
export const metadata: Metadata = {
  metadataBase: new URL("https://oncoguide.cc"),
  title: { default: "OncoGuide — Cancer science, made approachable", template: "%s — OncoGuide" },
  description: "Open lessons in cancer biology, immunotherapy, molecular profiling, and the science behind treatment.",
};
const themeScript = `(function(){try{var t=localStorage.getItem('theme');var d=t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);document.documentElement.style.colorScheme=d?'dark':'light'}catch(e){}})()`;
export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head><body><EducationFrame topics={navigation}>{children}</EducationFrame></body></html>;
}
