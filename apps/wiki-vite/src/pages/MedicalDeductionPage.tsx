import { MedicalDeductionCalculator } from "../../../../apps/web/src/app/(main)/tools/medical-deduction/calculator-client";

export function MedicalDeductionPage() {
  return (
    <article className="page-shell medical-deduction-shell" data-test-id="medical-deduction-page">
      <header className="page-header">
        <div className="wiki-shell-page-header-main">
          <div className="wiki-shell-page-title-row">
            <h1>Medical Expense Deduction Calculator</h1>
          </div>
          <p>
            Federal + California, MFJ. Estimates the tax benefit of qualified medical
            expenses under IRC 213.
          </p>
        </div>
      </header>
      <MedicalDeductionCalculator />
    </article>
  );
}
