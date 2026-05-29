"use client";

import { useEffect, useMemo, useState } from "react";

// ─── Tax engine ───────────────────────────────────────────────────────────────

const STD_DEDUCTION_MFJ = 32_200;
const SALT_CAP = 10_000;
const AGI_FLOOR = 0.075;
const TOP_BRACKET_MFJ_2026 = 768_600;
const HIGH_EARNER_HAIRCUT_RATIO = 2 / 37; // OB3 / OBBBA 35% itemized cap, expressed per Kate's spreadsheet

type Bracket = { top: number; rate: number };

const FED_BRACKETS: Bracket[] = [
  { top: 25_000, rate: 0.10 },
  { top: 103_000, rate: 0.12 },
  { top: 207_000, rate: 0.22 },
  { top: 394_000, rate: 0.24 },
  { top: 502_000, rate: 0.32 },
  { top: 770_000, rate: 0.35 },
  { top: Infinity, rate: 0.37 },
];

const CA_BRACKETS: Bracket[] = [
  { top: 20_800, rate: 0.01 },
  { top: 49_400, rate: 0.02 },
  { top: 77_900, rate: 0.04 },
  { top: 108_200, rate: 0.06 },
  { top: 136_700, rate: 0.08 },
  { top: 698_300, rate: 0.093 },
  { top: 838_000, rate: 0.103 },
  { top: 1_396_500, rate: 0.113 },
  { top: Infinity, rate: 0.123 },
];

function bracketTax(taxable: number, brackets: Bracket[]) {
  if (taxable <= 0) return 0;
  let tax = 0;
  let prev = 0;
  for (const b of brackets) {
    if (taxable <= b.top) {
      tax += (taxable - prev) * b.rate;
      return tax;
    }
    tax += (b.top - prev) * b.rate;
    prev = b.top;
  }
  return tax;
}

function caMentalHealth(taxable: number) {
  return Math.max(0, taxable - 1_000_000) * 0.01;
}

interface CalcResult {
  floor: number;
  deductibleMedical: number;
  itemized: number;
  tiBaseline: number;
  tiWith: number;
  fedBaseline: number;
  fedWith: number;
  fedSavings: number;
  obbba: number;
  caBaseline: number;
  caWith: number;
  caSavings: number;
  totalSavings: number;
  subsidyPct: number;
  netCost: number;
  wasted: number;
}

function calc(agi: number, medical: number): CalcResult {
  const floor = agi * AGI_FLOOR;
  const deductibleMedical = Math.max(0, medical - floor);
  const totalPotentiallyDeductible = deductibleMedical > 0 ? deductibleMedical + SALT_CAP : 0;

  // High-earner haircut (per Kate's formula at the tax firm, mirroring OB3/OBBBA 35% itemized cap):
  //   reduction = MIN( (2/37) × total_potentially_deductible , (2/37) × (AGI − $768,600) )
  // applied as a reduction to the deductible amount itself.
  let highEarnerReduction = 0;
  if (agi > TOP_BRACKET_MFJ_2026) {
    highEarnerReduction = Math.min(
      HIGH_EARNER_HAIRCUT_RATIO * totalPotentiallyDeductible,
      HIGH_EARNER_HAIRCUT_RATIO * (agi - TOP_BRACKET_MFJ_2026),
    );
  }
  const itemized = Math.max(0, totalPotentiallyDeductible - highEarnerReduction);

  const baselineDeduction = Math.max(STD_DEDUCTION_MFJ, SALT_CAP);
  const tiBaseline = Math.max(0, agi - baselineDeduction);
  const useItemize = itemized > STD_DEDUCTION_MFJ;
  const tiWith = useItemize ? Math.max(0, agi - itemized) : tiBaseline;

  const fedBaseline = bracketTax(tiBaseline, FED_BRACKETS);
  const fedWith = bracketTax(tiWith, FED_BRACKETS);
  const fedSavings = fedBaseline - fedWith;

  // `obbba` field: federal-tax cost of the high-earner haircut, computed at the
  // 37% marginal rate of the lost deduction. Used by the comparison table.
  const obbba = highEarnerReduction * 0.37;

  const caBaseline = bracketTax(tiBaseline, CA_BRACKETS) + caMentalHealth(tiBaseline);
  const caWith = bracketTax(tiWith, CA_BRACKETS) + caMentalHealth(tiWith);
  const caSavings = caBaseline - caWith;

  const wasted = Math.max(0, itemized - agi);
  const totalSavings = fedSavings + caSavings;
  const subsidyPct = medical > 0 ? totalSavings / medical : 0;
  const netCost = medical - totalSavings;

  return {
    floor, deductibleMedical, itemized,
    tiBaseline, tiWith,
    fedBaseline, fedWith, fedSavings, obbba,
    caBaseline, caWith, caSavings,
    totalSavings, subsidyPct, netCost, wasted,
  };
}

// ─── Formatters ───────────────────────────────────────────────────────────────

const fmtMoney = (n: number) => {
  const sign = n < 0 ? "−" : "";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return sign + "$" + (abs / 1_000_000).toFixed(2) + "M";
  if (abs >= 1_000) return sign + "$" + Math.round(abs / 1_000).toLocaleString() + "K";
  return sign + "$" + Math.round(abs).toLocaleString();
};
const fmtMoneyExact = (n: number) => {
  const sign = n < 0 ? "−" : "";
  return sign + "$" + Math.round(Math.abs(n)).toLocaleString();
};
const fmtPct = (n: number) => Math.round(n * 100) + "%";

// ─── Multi-year optimizer ─────────────────────────────────────────────────────

// Default distribution: frontload year 1 up to the wasted-deduction boundary,
// then overflow into year 2, year 3, etc. This concentrates spend earliest while
// avoiding wasted deduction in any single year.
//
// Per-year capacity (no wasted deduction): itemized ≤ AGI
//   itemized = (medical - 0.075·AGI) + SALT
//   medical_max = 1.075·AGI - SALT
function frontloadSplit(agis: number[], totalMedical: number): number[] {
  const n = agis.length;
  const allocation = new Array<number>(n).fill(0);
  let remaining = totalMedical;
  for (let i = 0; i < n; i++) {
    const cap = Math.max(0, (1 + AGI_FLOOR) * agis[i] - SALT_CAP);
    const take = Math.min(remaining, cap);
    allocation[i] = Math.round(take / 1000) * 1000;
    remaining = totalMedical - allocation.reduce((s, v) => s + v, 0);
    if (remaining <= 0) break;
  }
  if (remaining > 0) {
    allocation[n - 1] += remaining;
  }
  return allocation;
}

// ─── Component ────────────────────────────────────────────────────────────────

interface YearData { agi: number; medical: number }

export function MedicalDeductionCalculator() {
  const [agi, setAgi] = useState(250_000);
  const [medical, setMedical] = useState(150_000);

  // Multi-year state
  const [spread, setSpread] = useState(false);
  const [customize, setCustomize] = useState(false);
  const [years, setYears] = useState(3);
  const [yearData, setYearData] = useState<YearData[]>(() => initializeYears(3, 250_000, 150_000));

  const r = calc(agi, medical);

  // When spread is OFF: keep yearData synced to single-year defaults so toggling on is consistent.
  // When spread is ON & customize is OFF: auto-optimize on every relevant change.
  // When spread is ON & customize is ON: user-driven; AGI changes still propagate to all years
  //   only on first activation; thereafter user edits stand.
  useEffect(() => {
    if (!spread) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resync yearData to single-year defaults when spread toggles off
      setYearData(initializeYears(years, agi, medical));
      return;
    }
    if (!customize) {
      const agis = new Array(years).fill(agi);
      const allocation = frontloadSplit(agis, medical);
      setYearData(agis.map((a, i) => ({ agi: a, medical: allocation[i] ?? 0 })));
    }
  }, [spread, customize, years, agi, medical]);

  function setYearCount(n: number) {
    setYears(n);
    if (spread && customize) {
      // resize yearData preserving distribution proportionally
      setYearData((prev) => {
        if (n === prev.length) return prev;
        if (n > prev.length) {
          const extra = n - prev.length;
          const filler: YearData[] = new Array(extra).fill(0).map(() => ({ agi, medical: 0 }));
          return [...prev, ...filler];
        }
        return prev.slice(0, n);
      });
    }
  }

  function updateYear(i: number, field: keyof YearData, value: number) {
    setCustomize(true);
    setYearData((prev) => prev.map((y, idx) => (idx === i ? { ...y, [field]: value } : y)));
  }

  // Editing a year's AGI (without entering customize mode) re-runs the
  // frontload split using the new per-year AGIs. This is how the planner
  // factors in income changes year-to-year (e.g., bonus year, partner
  // stops working). Master AGI slider still resets all years.
  function updateYearAgi(i: number, value: number) {
    setYearData((prev) => {
      const newAgis = prev.map((y, idx) => (idx === i ? value : y.agi));
      if (!customize) {
        const allocation = frontloadSplit(newAgis, medical);
        return prev.map((y, idx) => ({ agi: newAgis[idx], medical: allocation[idx] ?? 0 }));
      }
      return prev.map((y, idx) => (idx === i ? { ...y, agi: value } : y));
    });
  }

  function reoptimize() {
    setCustomize(false);
    const agis = yearData.map((y) => y.agi);
    const total = yearData.reduce((s, y) => s + y.medical, 0) || medical;
    const allocation = frontloadSplit(agis, total);
    setYearData((prev) => prev.map((y, i) => ({ ...y, medical: allocation[i] ?? 0 })));
  }

  return (
    <div className="space-y-6">
      <Panel>
        <div className="grid gap-4 sm:grid-cols-2">
          <Slider
            label="Adjusted Gross Income (AGI)"
            value={agi}
            min={100_000}
            max={2_000_000}
            step={10_000}
            onChange={setAgi}
          />
          <Slider
            label="Qualified Medical Expenses"
            value={medical}
            min={0}
            max={2_000_000}
            step={10_000}
            onChange={setMedical}
          />
        </div>
      </Panel>

      <Hero
        result={r}
        medical={medical}
        spread={spread}
        onSpread={() => {
          setSpread(true);
          requestAnimationFrame(() => {
            document
              .getElementById("multi-year")
              ?.scrollIntoView({ behavior: "smooth", block: "start" });
          });
        }}
      />

      <SectionHeader>Breakdown</SectionHeader>
      <Panel>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Federal Savings" value={fmtMoneyExact(r.fedSavings)} sub={r.obbba > 0 ? `After ${fmtMoneyExact(r.obbba)} high-earner haircut` : "After 37%-bracket cap"} />
          <Stat label="California Savings" value={fmtMoneyExact(r.caSavings)} />
          <Stat label="7.5% AGI Floor" value={fmtMoneyExact(r.floor)} sub="Non-deductible base" />
          <Stat label="Deductible Amount" value={fmtMoneyExact(r.deductibleMedical)} sub="After floor" />
        </div>
      </Panel>

      <SectionHeader>Tax Comparison</SectionHeader>
      <Panel>
        <ComparisonTable r={r} />
      </Panel>

      <SectionHeader>Savings Curve at Current AGI</SectionHeader>
      <Panel>
        <SavingsCurve agi={agi} currentMedical={medical} />
      </Panel>

      <SectionHeader>Sensitivity Grid</SectionHeader>
      <Panel>
        <Heatmap onSelect={(a, m) => { setAgi(a); setMedical(m); }} />
        <p className="mt-3 text-sm text-[var(--text-muted)]">
          Cells shaded by tax savings. ⚠ = medical deduction exceeds taxable income; additional spend in that cell produces no benefit. Click a cell to load it.
        </p>
      </Panel>

      <SectionHeader id="multi-year">Multi-Year Strategy</SectionHeader>
      <Panel>
        <MultiYearPlanner
          spread={spread}
          onSetSpread={setSpread}
          customize={customize}
          onSetCustomize={setCustomize}
          yearData={yearData}
          years={years}
          totalMedical={medical}
          onSetYears={setYearCount}
          onUpdateYear={updateYear}
          onUpdateYearAgi={updateYearAgi}
          onReoptimize={reoptimize}
        />
      </Panel>

      <SectionHeader>Notes &amp; Caveats</SectionHeader>
      <Panel>
        <ul className="space-y-2 text-sm text-[var(--text-muted)]">
          <li>2026 federal MFJ brackets, inflation-projected. 37% bracket starts at <strong>$768,600 MFJ</strong>. High-earner haircut applied per Kate&apos;s tax-firm formula (4/29 call): the deduction is reduced by <strong>MIN((2/37) × total itemized, (2/37) × (AGI − $768,600))</strong> — the OB3 / OBBBA 35% cap expressed as a deduction-amount reduction.</li>
          <li>2026 California MFJ brackets including the 1% mental-health surcharge above $1M. CA conforms to the federal 7.5% AGI floor for medical.</li>
          <li>Baseline assumes the <strong>2026 standard deduction ($32,200 MFJ)</strong> when not itemizing. SALT capped at $10K (fully phased back at AGI &gt; ~$600K under OBBBA) and not modeled separately.</li>
          <li>Deduction timing follows when cash leaves (credit-card charge date counts; statement-payment date does not). Year-end timing of large invoices may shift the deduction across tax years.</li>
          <li>Does not model AMT, NIIT, payroll tax, or capital gains. NIIT does not move with the medical deduction since medical is below-the-line.</li>
          <li>Assumes all medical spend qualifies under IRC §213(d). Echo Services Fee qualification is a separate question addressed by the SOW v2.3 clarifying amendments.</li>
          <li>Estimates only. Confirm with a tax professional before relying on these numbers for planning.</li>
        </ul>
      </Panel>
    </div>
  );
}

function initializeYears(n: number, agi: number, total: number): YearData[] {
  const per = total / n;
  const data: YearData[] = [];
  for (let i = 0; i < n; i++) {
    data.push({ agi, medical: Math.round(per / 1000) * 1000 });
  }
  const sum = data.reduce((s, y) => s + y.medical, 0);
  data[n - 1].medical += (total - sum);
  return data;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--background,white)] p-5 shadow-sm">
      {children}
    </div>
  );
}

function SectionHeader({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <h2 id={id} className="mb-2 mt-6 scroll-mt-6 text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
      {children}
    </h2>
  );
}

function Slider({ label, value, min, max, step, onChange }: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void;
}) {
  const [text, setText] = useState(value.toLocaleString());

  // Keep the text input in sync when the value changes externally (slider, heatmap clicks, etc.)
  useEffect(() => {
    setText(value.toLocaleString());
  }, [value]);

  function commitText(raw: string) {
    const n = Number(raw.replace(/[^0-9.-]/g, ""));
    if (Number.isFinite(n)) {
      const clamped = Math.max(min, Math.min(max, n));
      onChange(clamped);
      setText(clamped.toLocaleString());
    } else {
      setText(value.toLocaleString());
    }
  }

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-sm text-[var(--text-muted)]">{label}</span>
        <input
          type="text"
          inputMode="numeric"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={(e) => commitText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.currentTarget.blur();
            }
          }}
          aria-label={label}
          className="w-32 rounded-md border border-transparent bg-transparent px-2 py-0.5 text-right text-lg font-semibold tabular-nums hover:border-[var(--border)] focus:border-[var(--brand)] focus:bg-[var(--background,white)] focus:outline-none"
        />
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(+e.target.value)}
        className="w-full accent-[var(--brand)]"
      />
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-[var(--muted)] p-3 text-center">
      <div className="text-xs uppercase tracking-wider text-[var(--text-muted)]">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
      {sub ? <div className="text-xs text-[var(--text-muted)]">{sub}</div> : null}
    </div>
  );
}

function Hero({ result, medical, spread, onSpread }: {
  result: CalcResult;
  medical: number;
  spread: boolean;
  onSpread: () => void;
}) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-gradient-to-br from-[var(--accent-light)] to-[var(--muted)] p-8 text-center shadow-sm">
      <div className="text-sm text-[var(--text-muted)]">Estimated Tax Savings</div>
      <div className="my-2 text-5xl font-bold tabular-nums text-[var(--brand)]">
        {fmtMoneyExact(result.totalSavings)}
      </div>
      <div className="text-sm">
        Effective subsidy: <strong>{fmtPct(result.subsidyPct)}</strong>
        {" · "}Net cost after savings: <strong>{fmtMoneyExact(result.netCost)}</strong>
      </div>
      {result.wasted > 1000 && medical > 0 && !spread ? (
        <div className="mx-auto mt-4 flex max-w-2xl flex-wrap items-center justify-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
          <span>
            <strong>{fmtMoneyExact(result.wasted)}</strong> of this spend gets no tax benefit in a single year.
          </span>
          <button
            onClick={onSpread}
            className="rounded-md border border-amber-500/60 bg-amber-500/20 px-3 py-1 text-xs font-semibold text-amber-900 transition-colors hover:bg-amber-500/30 dark:text-amber-200"
          >
            Spread across years →
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ComparisonTable({ r }: { r: CalcResult }) {
  const totalBase = r.fedBaseline + r.caBaseline;
  const totalWith = r.fedWith + r.caWith;
  const cell = "px-3 py-2 text-right tabular-nums";
  const head = "px-3 py-2 text-right text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]";
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--border)]">
            <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]"></th>
            <th className={head}>Without Deduction</th>
            <th className={head}>With Deduction</th>
            <th className={head}>Difference</th>
          </tr>
        </thead>
        <tbody>
          <Row label="Taxable income" base={r.tiBaseline} withVal={r.tiWith} diff={r.tiWith - r.tiBaseline} cell={cell} />
          <Row label="Federal tax" base={r.fedBaseline} withVal={r.fedWith} diff={-r.fedSavings} cell={cell} />
          <Row label="California tax" base={r.caBaseline} withVal={r.caWith} diff={-r.caSavings} cell={cell} />
          <tr className="border-t-2 border-[var(--border)] font-semibold">
            <td className="px-3 py-2 text-left">Total tax</td>
            <td className={cell}>{fmtMoneyExact(totalBase)}</td>
            <td className={cell}>{fmtMoneyExact(totalWith)}</td>
            <td className={cell}>{fmtMoneyExact(-r.totalSavings)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function Row({ label, base, withVal, diff, cell }: { label: string; base: number; withVal: number; diff: number; cell: string }) {
  return (
    <tr className="border-b border-[var(--border)]">
      <td className="px-3 py-2 text-left">{label}</td>
      <td className={cell}>{fmtMoneyExact(base)}</td>
      <td className={cell}>{fmtMoneyExact(withVal)}</td>
      <td className={cell}>{fmtMoneyExact(diff)}</td>
    </tr>
  );
}

function SavingsCurve({ agi, currentMedical }: { agi: number; currentMedical: number }) {
  const W = 800, H = 320;
  const margin = { top: 20, right: 24, bottom: 44, left: 70 };
  const innerW = W - margin.left - margin.right;
  const innerH = H - margin.top - margin.bottom;

  const data = useMemo(() => {
    const maxMedical = Math.max(2_000_000, currentMedical * 1.2);
    const points: { m: number; savings: number; wasted: number }[] = [];
    let maxSavings = 0;
    let wastedX: number | null = null;
    for (let i = 0; i <= 100; i++) {
      const m = (i / 100) * maxMedical;
      const r = calc(agi, m);
      points.push({ m, savings: r.totalSavings, wasted: r.wasted });
      if (r.totalSavings > maxSavings) maxSavings = r.totalSavings;
      if (wastedX === null && r.wasted > 1000) wastedX = m;
    }
    return { points, maxSavings, maxMedical, wastedX };
  }, [agi, currentMedical]);

  const xScale = (m: number) => margin.left + (m / data.maxMedical) * innerW;
  const yScale = (s: number) => margin.top + innerH - (s / Math.max(data.maxSavings, 1)) * innerH;

  const pathD = data.points.map((p, i) => `${i === 0 ? "M" : "L"} ${xScale(p.m)} ${yScale(p.savings)}`).join(" ");
  const areaD = `M ${xScale(0)} ${yScale(0)} ${data.points.map((p) => `L ${xScale(p.m)} ${yScale(p.savings)}`).join(" ")} L ${xScale(data.maxMedical)} ${yScale(0)} Z`;

  const cur = calc(agi, currentMedical);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" className="w-full">
      {[0, 1, 2, 3, 4].map((i) => {
        const y = margin.top + (i / 4) * innerH;
        const val = data.maxSavings * (1 - i / 4);
        return (
          <g key={i}>
            <line x1={margin.left} y1={y} x2={W - margin.right} y2={y} stroke="var(--border)" strokeDasharray="2,3" />
            <text x={margin.left - 8} y={y + 4} textAnchor="end" fontSize="11" fill="var(--text-muted)">{fmtMoney(val)}</text>
          </g>
        );
      })}
      {[0, 1, 2, 3, 4, 5].map((i) => {
        const m = (i / 5) * data.maxMedical;
        return (
          <text key={i} x={xScale(m)} y={H - margin.bottom + 18} textAnchor="middle" fontSize="11" fill="var(--text-muted)">
            {fmtMoney(m)}
          </text>
        );
      })}
      <text x={margin.left + innerW / 2} y={H - 6} textAnchor="middle" fontSize="11" fill="var(--text-muted)">
        Qualified medical expenses
      </text>
      {data.wastedX !== null ? (
        <>
          <line x1={xScale(data.wastedX)} y1={margin.top} x2={xScale(data.wastedX)} y2={margin.top + innerH} stroke="rgb(245, 158, 11)" strokeDasharray="4,4" strokeWidth={1.5} />
          <text x={xScale(data.wastedX) + 6} y={margin.top + 14} fontSize="11" fill="rgb(245, 158, 11)">deduction caps</text>
        </>
      ) : null}
      <path d={areaD} fill="var(--brand)" fillOpacity={0.1} />
      <path d={pathD} fill="none" stroke="var(--brand)" strokeWidth={2.5} />
      <circle cx={xScale(currentMedical)} cy={yScale(cur.totalSavings)} r={6} fill="var(--brand)" stroke="var(--background,white)" strokeWidth={2} />
      <text x={xScale(currentMedical)} y={yScale(cur.totalSavings) - 12} textAnchor="middle" fontSize="11" fill="var(--brand)" fontWeight={600}>
        {fmtMoney(cur.totalSavings)}
      </text>
    </svg>
  );
}

const HEAT_AGIS = [250_000, 500_000, 700_000, 900_000, 1_160_000, 1_400_000];
const HEAT_MEDS = [100_000, 250_000, 500_000, 750_000, 1_000_000, 1_250_000, 1_500_000];

function Heatmap({ onSelect }: { onSelect: (agi: number, med: number) => void }) {
  const grid = useMemo(() => {
    const rows = HEAT_AGIS.map((a) =>
      HEAT_MEDS.map((m) => {
        const r = calc(a, m);
        return { agi: a, med: m, savings: r.totalSavings, wasted: r.wasted };
      })
    );
    const max = rows.reduce(
      (acc, row) => row.reduce((rowMax, cell) => Math.max(rowMax, cell.savings), acc),
      0
    );
    return { rows, max };
  }, []);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm tabular-nums">
        <thead>
          <tr>
            <th className="px-2 py-2 text-left text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">AGI \ Medical</th>
            {HEAT_MEDS.map((m) => (
              <th key={m} className="px-2 py-2 text-right text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
                {fmtMoney(m)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.rows.map((row, i) => (
            <tr key={i} className="border-t border-[var(--border)]">
              <th className="px-2 py-2 text-left font-medium">{fmtMoney(HEAT_AGIS[i])}</th>
              {row.map((cell, j) => {
                const intensity = cell.savings / Math.max(grid.max, 1);
                const flag = cell.wasted > 1000 ? " ⚠" : "";
                return (
                  <td
                    key={j}
                    className="cursor-pointer px-2 py-2 text-right transition-opacity hover:opacity-70"
                    style={{ background: `hsla(155, 60%, 50%, ${intensity * 0.5})` }}
                    onClick={() => onSelect(cell.agi, cell.med)}
                  >
                    {fmtMoney(cell.savings) + flag}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MultiYearPlanner({
  spread, onSetSpread,
  customize, onSetCustomize,
  yearData, years, totalMedical,
  onSetYears, onUpdateYear, onUpdateYearAgi, onReoptimize,
}: {
  spread: boolean;
  onSetSpread: (v: boolean) => void;
  customize: boolean;
  onSetCustomize: (v: boolean) => void;
  yearData: YearData[];
  years: number;
  totalMedical: number;
  onSetYears: (n: number) => void;
  onUpdateYear: (i: number, field: keyof YearData, value: number) => void;
  onUpdateYearAgi: (i: number, value: number) => void;
  onReoptimize: () => void;
}) {
  const singleYearSavings = calc(yearData[0]?.agi ?? 0, totalMedical).totalSavings;
  const allocatedSavings = yearData.reduce((s, y) => s + calc(y.agi, y.medical).totalSavings, 0);
  const subsidy = totalMedical > 0 ? allocatedSavings / totalMedical : 0;
  const vsBunch = allocatedSavings - singleYearSavings;

  return (
    <div className="space-y-5">
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={spread}
          onChange={(e) => onSetSpread(e.target.checked)}
          className="mt-1 size-4 accent-[var(--brand)]"
        />
        <div>
          <div className="font-medium">Spread costs across multiple tax years</div>
          <div className="text-sm text-[var(--text-muted)]">
            Medical deductions don&apos;t carry forward. Splitting expenses across years can recover savings if a single year can&apos;t absorb the full deduction — but you pay the 7.5% AGI floor each year.
          </div>
        </div>
      </label>

      {spread ? (
        <>
          <div className="flex flex-wrap items-end gap-6 border-t border-[var(--border)] pt-5">
            <div>
              <div className="mb-1 text-sm text-[var(--text-muted)]">Number of tax years</div>
              <div className="flex gap-1">
                {[2, 3, 4].map((n) => (
                  <button
                    key={n}
                    onClick={() => onSetYears(n)}
                    className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                      years === n
                        ? "border-[var(--brand)] bg-[var(--brand)] text-white"
                        : "border-[var(--border)] bg-[var(--muted)] hover:border-[var(--brand)]"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={customize}
                onChange={(e) => onSetCustomize(e.target.checked)}
                className="size-4 accent-[var(--brand)]"
              />
              <span className="text-sm">Customize distribution</span>
            </label>
            {customize ? (
              <button
                onClick={onReoptimize}
                className="rounded-md border border-[var(--brand)] px-3 py-1.5 text-sm font-medium text-[var(--brand)] transition-colors hover:bg-[var(--brand)] hover:text-white"
              >
                Reset to default
              </button>
            ) : (
              <span className="text-sm italic text-[var(--text-muted)]">
                Frontloaded · edit per-year AGI to model income changes, or toggle &ldquo;Customize&rdquo; to set medical spend manually
              </span>
            )}
          </div>

          <div className="space-y-2">
            {yearData.map((y, i) => {
              const r = calc(y.agi, y.medical);
              return (
                <div key={i} className="grid items-center gap-3 rounded-lg bg-[var(--muted)] p-3 sm:grid-cols-[60px_1fr_1fr_160px]">
                  <div className="text-sm font-semibold text-[var(--text-muted)]">Year {i + 1}</div>
                  <NumberInput
                    label="AGI"
                    value={y.agi}
                    step={10_000}
                    onChange={(v) => (customize ? onUpdateYear(i, "agi", v) : onUpdateYearAgi(i, v))}
                  />
                  {customize ? (
                    <NumberInput label="Medical spend" value={y.medical} step={10_000} onChange={(v) => onUpdateYear(i, "medical", v)} />
                  ) : (
                    <ReadOnlyField label="Medical spend" value={fmtMoneyExact(y.medical)} />
                  )}
                  <div className="text-right">
                    <div className="text-base font-semibold tabular-nums text-[var(--brand)]">{fmtMoneyExact(r.totalSavings)}</div>
                    <div className="text-xs text-[var(--text-muted)]">
                      saved · {fmtPct(y.medical > 0 ? r.totalSavings / y.medical : 0)} subsidy
                    </div>
                    {r.wasted > 1000 ? (
                      <div className="text-xs text-amber-600 dark:text-amber-400">⚠ {fmtMoneyExact(r.wasted)} wasted</div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat label="Total savings (spread)" value={fmtMoneyExact(allocatedSavings)} />
            <Stat label="vs. all in one year" value={fmtMoneyExact(singleYearSavings)} sub={(vsBunch >= 0 ? "+" : "") + fmtMoneyExact(vsBunch) + " from spreading"} />
            <Stat label="Effective subsidy" value={fmtPct(subsidy)} />
          </div>

          {Math.abs(vsBunch) < 1000 ? (
            <p className="text-sm text-[var(--text-muted)]">
              Spreading produces no material benefit at this spend level — a single year can absorb the full deduction.
            </p>
          ) : vsBunch > 0 ? (
            <p className="text-sm text-emerald-700 dark:text-emerald-400">
              Spreading recovers <strong>{fmtMoneyExact(vsBunch)}</strong> compared to bunching everything into one year.
            </p>
          ) : (
            <p className="text-sm text-amber-700 dark:text-amber-400">
              Bunching beats this distribution by <strong>{fmtMoneyExact(-vsBunch)}</strong>. Try unchecking &ldquo;Customize&rdquo; to auto-optimize.
            </p>
          )}
        </>
      ) : null}
    </div>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wider text-[var(--text-muted)]">{label}</span>
      <div className="rounded-md border border-dashed border-[var(--border)] bg-[var(--background,white)]/50 px-3 py-1.5 text-sm tabular-nums text-[var(--text-muted)]">
        {value}
      </div>
    </div>
  );
}

function NumberInput({ label, value, step, onChange }: { label: string; value: number; step: number; onChange: (v: number) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wider text-[var(--text-muted)]">{label}</span>
      <input
        type="number"
        value={value}
        step={step}
        onChange={(e) => onChange(+e.target.value)}
        className="rounded-md border border-[var(--border)] bg-[var(--background,white)] px-3 py-1.5 text-sm tabular-nums"
      />
    </label>
  );
}
