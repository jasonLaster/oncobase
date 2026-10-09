import { Suspense } from "react";
import { EducationSearch } from "../../../components/search";
export const metadata = { title: "Search education", alternates: { canonical: "/education/search/" }, robots: { index: false } };
export default function SearchPage() { return <Suspense fallback={<p role="status">Loading search…</p>}><EducationSearch /></Suspense>; }
