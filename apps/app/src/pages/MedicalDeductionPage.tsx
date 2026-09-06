import { MedicalDeductionCalculator } from "./medical-deduction-calculator";

export function MedicalDeductionPage() {
  return (
    <article className="mx-auto max-w-5xl px-4 py-8 sm:py-12 [--text-muted:#626b78] dark:[--text-muted:#9ca3af]" data-test-id="medical-deduction-page">
      <header className="mb-8">
        <h1 className="text-3xl font-bold">Medical Expense Deduction Calculator</h1>
        <p className="mt-2 text-[var(--text-muted)]">
          Federal + California, MFJ. Estimates the tax benefit of qualified medical
          expenses under IRC §213.
        </p>
      </header>
      <MedicalDeductionCalculator />
    </article>
  );
}
