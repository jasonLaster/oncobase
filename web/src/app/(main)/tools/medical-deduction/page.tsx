import { MedicalDeductionCalculator } from "./calculator-client";

export const metadata = {
  title: "Medical Expense Deduction Calculator",
};

// Embeds a Convex-using client component; render dynamic.
export const dynamic = "force-dynamic";

export default function MedicalDeductionPage() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:py-12">
        <header className="mb-8">
          <h1 className="text-3xl font-bold">Medical Expense Deduction Calculator</h1>
          <p className="mt-2 text-[var(--text-muted)]">
            Federal + California, MFJ. Estimates the tax benefit of qualified medical
            expenses under IRC §213.
          </p>
        </header>
        <MedicalDeductionCalculator />
      </div>
    </div>
  );
}
