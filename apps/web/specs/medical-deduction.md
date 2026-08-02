# Medical Expense Deduction Calculator Feature Spec

This document describes the shared calculator rendered by the legacy app and
the Vite reader at `/tools/medical-deduction`. It is a planning estimate, not
tax advice.

## Inputs

- `Adjusted Gross Income (AGI)` accepts $100,000 through $2,000,000.
- `Qualified Medical Expenses` accepts $0 through $2,000,000.
- Each value can be changed with either an explicitly named range control or a
  formatted text input. Text entries are clamped to the supported range when
  committed by blur or Enter.

## Calculation contract

- Filing status is 2026 married filing jointly.
- Qualified medical expenses become deductible only above 7.5% of AGI.
- The model includes the $32,200 federal standard deduction, a $10,000 SALT
  amount, 2026 projected federal and California brackets, California's 1%
  mental-health surcharge above $1 million, and the documented high-earner
  itemized-deduction haircut.
- The summary reports estimated total tax savings, effective subsidy, and net
  medical cost. The breakdown separates federal and California savings, the
  AGI floor, and the deductible amount.
- At the default $250,000 AGI and $150,000 spend, the rounded total savings is
  $33,985 and net cost is $116,015.
- A zero medical expense produces zero savings and zero net medical cost.

## Interactive planning contract

- The primary inputs and the complete multi-year scenario are written to URL
  query parameters as they change. Opening or reloading that URL restores the
  same inputs, year count, mode, per-year AGIs, and customized medical spend.
- Selecting a sensitivity-grid cell updates both primary inputs and the
  summary. Cells are operable by pointer, Enter, and Space and have an
  accessible name describing AGI, spend, savings, and the wasted-deduction
  warning when applicable.
- The multi-year control can spread costs across two, three, or four years.
  Automatic mode frontloads expenses without exceeding the modeled useful
  deduction capacity; customize mode permits per-year edits and exposes a
  reset-to-default action.
- Changing an individual year's AGI in automatic mode recalculates the
  frontloaded distribution.

## Responsive and safety contract

- The calculator must not create document-level horizontal overflow at mobile
  width; dense comparison and sensitivity tables own their horizontal scroll.
- Every range input and interactive grid cell has an accessible name and
  keyboard operation.
- The caveats remain visible and state the model's omissions and the need to
  confirm the estimate with a tax professional.

## Automated coverage

`apps/wiki-vite/e2e/medical-deduction.spec.ts` verifies default results, input
updates and clamping, URL persistence and reload restoration, keyboard
sensitivity-grid selection, multi-year controls, accessible names, and mobile
overflow. The pure tax formulas still live in the shared calculator component,
so the same interactions exercise the component used by both renderers.
