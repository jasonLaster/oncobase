"use client";

import { useId, useState, type CSSProperties, type ReactNode } from "react";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@oncobase/ui/tabs";

type Pair<T> = readonly [T, T];
type Metric = { label: string; short?: string; timing?: string };
type Step = {
  label: string;
  detail?: string;
  values: Pair<string>;
  approximate?: Pair<boolean>;
  kind?: "total";
};
type Scenario = { id: string; label: string; note?: string; steps: readonly Step[] };

export type ScenarioWaterfallProps = {
  metrics: Pair<Metric>;
  scenarios: readonly Scenario[];
  domain?: Pair<number>;
};

export type ScenarioWalkthroughProps = {
  metrics: Pair<Metric>;
  steps: readonly Step[];
  domain?: Pair<number>;
  /** Names the chart for screen readers. */
  label?: string;
  /** The step-by-step markdown the reader can switch to. */
  children?: ReactNode;
};

const ESTIMATE = /^\d+(?:\.\d{1,2})?$/;

function validData(metrics: unknown, steps: unknown, domain: unknown): boolean {
  if (!Array.isArray(metrics) || metrics.length !== 2 || metrics.some(m => !m?.label)) return false;
  if (!Array.isArray(domain) || !Number.isFinite(domain[0]) || !Number.isFinite(domain[1]) || domain[0] >= domain[1]) return false;
  if (!Array.isArray(steps) || !steps.length) return false;
  return steps.every(step => Array.isArray(step?.values) && step.values.length === 2 && step.values.every((value: unknown) =>
    typeof value === "string" && ESTIMATE.test(value) && Number(value) >= domain[0] && Number(value) <= domain[1]));
}

/** Gridlines every 10 points when the domain divides evenly, otherwise quarters. */
function ticks([low, high]: Pair<number>) {
  const span = high - low;
  const step = span % 10 === 0 && span / 10 <= 8 ? 10 : span / 4;
  return Array.from({ length: Math.round(span / step) + 1 }, (_, i) => low + i * step);
}

function Lane({ step, previous, metric, index, domain }: {
  step: Step;
  previous?: Step;
  metric: Metric;
  index: 0 | 1;
  domain: Pair<number>;
}) {
  const value = Number(step.values[index]);
  const from = previous ? Number(previous.values[index]) : domain[0];
  const total = !previous || step.kind === "total";
  const difference = Number((value - from).toFixed(2));
  const tone = total ? "is-total" : difference < 0 ? "is-loss" : "is-gain";
  const change = `${difference < 0 ? "−" : difference > 0 ? "+" : "±"}${Math.abs(difference)}`;
  const position = (n: number) => (n - domain[0]) * 100 / (domain[1] - domain[0]);
  const a = total ? 0 : position(Math.min(from, value));
  const b = position(total ? value : Math.max(from, value));
  const estimate = `${step.approximate?.[index] ? "≈" : ""}${step.values[index]}%`;
  const name = metric.short ?? metric.label;

  return (
    <div
      className="scenario-waterfall-lane"
      role="cell"
      aria-label={`${metric.label}: ${estimate}${total ? "" : `, ${change} pp`}`}
    >
      <span className="scenario-waterfall-tag" aria-hidden="true">{name}</span>
      <span className="scenario-waterfall-track" aria-hidden="true">
        <span className={`scenario-waterfall-bar ${tone}`} style={{ left: `${a}%`, width: `max(3px, ${b - a}%)` }} />
      </span>
      <span className="scenario-waterfall-number" aria-hidden="true">
        <strong>{estimate}</strong>
        {!total && <small className={tone}>{change}</small>}
      </span>
    </div>
  );
}

function WaterfallSteps({ label, metrics, steps, domain }: {
  label: string;
  metrics: Pair<Metric>;
  steps: readonly Step[];
  domain: Pair<number>;
}) {
  const marks = ticks(domain);
  const at = (n: number) => `${(n - domain[0]) * 100 / (domain[1] - domain[0])}%`;
  return (
    <div className="scenario-waterfall-chart not-prose" style={{ "--waterfall-ticks": marks.length - 1 } as CSSProperties}>
      <div role="table" aria-label={label}>
        <div className="scenario-waterfall-row scenario-waterfall-head" role="row">
          <div role="columnheader">Step</div>
          {/* Desktop puts the two metrics side by side; narrow containers stack them under one axis. */}
          <div className="scenario-waterfall-lanes">
            {metrics.map(metric => (
              <div role="columnheader" className="scenario-waterfall-axis" key={metric.label}
                aria-label={`${metric.label}, ${domain[0]}–${domain[1]}%`}>
                <span className="scenario-waterfall-tag" />
                <span className="scenario-waterfall-axis-body" aria-hidden="true">
                  <span className="scenario-waterfall-axis-title">{metric.short ?? metric.label}</span>
                  <span className="scenario-waterfall-ticks">
                    {marks.map(mark => <span key={mark} style={{ left: at(mark) }}>{mark}</span>)}
                  </span>
                </span>
                <span className="scenario-waterfall-number" aria-hidden="true">%</span>
              </div>
            ))}
          </div>
        </div>
        {steps.map((step, index) => (
          <div className={`scenario-waterfall-row${step.kind === "total" ? " is-result" : ""}`} role="row" key={`${index}:${step.label}`}>
            <div className="scenario-waterfall-step" role="rowheader">
              <strong>{step.label}</strong>
              {step.detail && <span>{step.detail}</span>}
            </div>
            <div className="scenario-waterfall-lanes">
              <Lane step={step} previous={steps[index - 1]} metric={metrics[0]} index={0} domain={domain} />
              <Lane step={step} previous={steps[index - 1]} metric={metrics[1]} index={1} domain={domain} />
            </div>
          </div>
        ))}
      </div>
      <p className="scenario-waterfall-key">
        {metrics.map(m => `${m.short ? `${m.short}: ` : ""}${m.label.toLowerCase()}${m.timing ? `, ${m.timing}` : ""}`).join(" · ")}.
        {" "}Each bar is the change from the step above, in percentage points; the scale runs {domain[0]}–{domain[1]}%.
        Changes are calculated from the displayed estimates.
      </p>
    </div>
  );
}

const ERROR = <p role="note">This waterfall has no valid scenario data.</p>;

/** One scenario's steps, switchable between a waterfall and the page's step-by-step text. */
export function ScenarioWalkthrough({ metrics, steps, domain = [0, 100], label = "Modeled steps", children }: ScenarioWalkthroughProps) {
  const [view, setView] = useState<"chart" | "text">("chart");
  const valid = validData(metrics, steps, domain);
  const style = <style href="scenario-waterfall" precedence="default">{styles}</style>;
  if (!valid) {
    return (
      <div className="scenario-walkthrough" data-view="text">
        {style}
        {children ? <div className="scenario-walkthrough-text">{children}</div> : ERROR}
      </div>
    );
  }
  return (
    <Tabs
      className="scenario-walkthrough"
      data-view={view}
      value={view}
      onValueChange={(next) => { if (next === "chart" || next === "text") setView(next); }}
    >
      {style}
      {children && (
        <TabsList className="scenario-walkthrough-toggle not-prose" aria-label="Show the steps as">
          <TabsTab value="chart">Waterfall</TabsTab>
          <TabsTab value="text">Step by step</TabsTab>
        </TabsList>
      )}
      <TabsPanel className="scenario-walkthrough-chart" value="chart" keepMounted>
        <WaterfallSteps label={label} metrics={metrics} steps={steps} domain={domain} />
      </TabsPanel>
      {children && <TabsPanel className="scenario-walkthrough-text" value="text" keepMounted>{children}</TabsPanel>}
    </Tabs>
  );
}

export default function ScenarioWaterfall({ metrics, scenarios, domain = [0, 100] }: ScenarioWaterfallProps) {
  const selectId = useId();
  const [selected, setSelected] = useState<string>();
  const scenario: Scenario | undefined = Array.isArray(scenarios)
    ? scenarios.find(item => item?.id === selected) ?? scenarios[0]
    : undefined;
  if (!scenario || !validData(metrics, scenario.steps, domain)) return ERROR;

  return (
    <div className="scenario-waterfall">
      <style href="scenario-waterfall" precedence="default">{styles}</style>
      {scenarios.length > 1 && (
        <div className="scenario-waterfall-control not-prose">
          <label htmlFor={selectId}>Scenario</label>
          <select id={selectId} value={scenario.id} onChange={event => setSelected(event.currentTarget.value)}>
            {scenarios.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </div>
      )}
      {scenario.note && <p className="scenario-waterfall-note">{scenario.note}</p>}
      <WaterfallSteps label={scenario.label} metrics={metrics} steps={scenario.steps} domain={domain} />
    </div>
  );
}

// Keep these styles with the lazy MDX component so other pages do not download them.
const styles = `
.scenario-walkthrough, .scenario-waterfall {
  --waterfall-line: color-mix(in srgb, currentColor 14%, transparent);
  --waterfall-muted: color-mix(in srgb, currentColor 66%, transparent);
  --waterfall-up: light-dark(#1a6858, #6ed4b0);
  --waterfall-down: light-dark(#a2402e, #ffad96);
  --waterfall-total: light-dark(#455d98, #a4b9fb);
  container-type: inline-size;
}

/* light-dark() follows color-scheme, which the reader's .dark class does not
   set; without this the dark theme kept the light (low-contrast) tones. */
.dark .scenario-walkthrough, .dark .scenario-waterfall {
  --waterfall-up: #6ed4b0;
  --waterfall-down: #ffad96;
  --waterfall-total: #a4b9fb;
}

.scenario-walkthrough-toggle {
  display: inline-flex;
  margin: 0 0 0.75rem;
  padding: 2px;
  border: 1px solid var(--waterfall-line);
  border-radius: 0.5rem;
  font-size: 0.8125rem;
}
.scenario-walkthrough-toggle button {
  min-height: 2rem;
  padding: 0.25rem 0.75rem;
  border: 0;
  border-radius: 0.375rem;
  background: transparent;
  color: inherit;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  opacity: 0.7;
}
.scenario-walkthrough-toggle button[data-selected] {
  background: color-mix(in srgb, currentColor 10%, transparent);
  opacity: 1;
}
.scenario-walkthrough-toggle button:focus-visible,
.scenario-waterfall-control select:focus-visible {
  outline: 2px solid var(--waterfall-total);
  outline-offset: 2px;
}
.scenario-walkthrough [hidden] { display: none; }

.scenario-waterfall-control {
  display: grid;
  gap: 0.375rem;
  margin-bottom: 0.75rem;
  font-size: 0.875rem;
  font-weight: 650;
}
.scenario-waterfall-control select {
  width: 100%;
  min-width: 0;
  min-height: 2.75rem;
  font: inherit;
  color: inherit;
  background: Canvas;
  border: 1px solid var(--waterfall-line);
  border-radius: 0.375rem;
  padding: 0.375rem 0.5rem;
}
.scenario-waterfall-note { font-size: 0.875rem; }

.scenario-waterfall-chart {
  font-size: 0.875rem;
  line-height: 1.35;
}
.scenario-waterfall-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.6fr);
  gap: 0.25rem 1rem;
  align-items: center;
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--waterfall-line);
}
.scenario-waterfall-head {
  padding-block: 0.25rem;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--waterfall-muted);
}
.scenario-waterfall-row.is-result { border-bottom: 0; }
.scenario-waterfall-row.is-result .scenario-waterfall-step strong { font-weight: 700; }

.scenario-waterfall-step { min-width: 0; overflow-wrap: anywhere; }
.scenario-waterfall-step strong { display: block; font-weight: 600; }
.scenario-waterfall-step span {
  display: block;
  margin-top: 0.125rem;
  font-size: 0.8125rem;
  color: var(--waterfall-muted);
}

.scenario-waterfall-lanes {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.25rem 1rem;
  min-width: 0;
}
.scenario-waterfall-lane, .scenario-waterfall-axis {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 4rem;
  gap: 0.5rem;
  align-items: center;
  min-width: 0;
}
.scenario-waterfall-axis { align-items: end; }
.scenario-waterfall-lane > .scenario-waterfall-tag,
.scenario-waterfall-axis > .scenario-waterfall-tag { display: none; }
.scenario-waterfall-axis-body { display: grid; gap: 0.125rem; min-width: 0; }
.scenario-waterfall-axis-title { font-weight: 650; }
.scenario-waterfall-tag {
  font-size: 0.6875rem;
  font-weight: 650;
  letter-spacing: 0.02em;
  color: var(--waterfall-muted);
}
.scenario-waterfall-track {
  position: relative;
  height: 0.875rem;
  background-image: linear-gradient(to right, var(--waterfall-line) 1px, transparent 1px);
  background-size: calc(100% / var(--waterfall-ticks, 4)) 100%;
  box-shadow: inset -1px 0 0 var(--waterfall-line);
}
.scenario-waterfall-bar {
  position: absolute;
  top: 0.125rem;
  bottom: 0.125rem;
  border-radius: 2px;
  background: currentColor;
}
.scenario-waterfall-ticks {
  position: relative;
  height: 1rem;
  font-variant-numeric: tabular-nums;
}
.scenario-waterfall-ticks span {
  position: absolute;
  white-space: nowrap;
  transform: translateX(-50%);
}
.scenario-waterfall-ticks span:first-child { transform: none; }
.scenario-waterfall-ticks span:last-child { transform: translateX(-100%); }

.scenario-waterfall-number {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  line-height: 1.2;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.scenario-waterfall-number strong { font-weight: 650; }
.scenario-waterfall-number small { min-width: 2.6em; font-size: 0.75rem; font-weight: 600; text-align: right; }
.scenario-waterfall-bar.is-total { color: var(--waterfall-total); }
.scenario-waterfall-chart .is-gain { color: var(--waterfall-up); }
.scenario-waterfall-chart .is-loss { color: var(--waterfall-down); }
.scenario-waterfall-lane .scenario-waterfall-number { min-width: 0; }

.scenario-waterfall-key {
  margin: 0.5rem 0 0;
  font-size: 0.75rem;
  color: var(--waterfall-muted);
}

@container (max-width: 40rem) {
  .scenario-waterfall-row, .scenario-waterfall-lanes { grid-template-columns: minmax(0, 1fr); }
  .scenario-waterfall-head > [role="columnheader"]:first-child,
  .scenario-waterfall-axis + .scenario-waterfall-axis,
  .scenario-waterfall-axis-title { display: none; }
  .scenario-waterfall-lane, .scenario-waterfall-axis { grid-template-columns: 2rem minmax(0, 1fr) 6.25rem; }
  .scenario-waterfall-lane > .scenario-waterfall-tag,
  .scenario-waterfall-axis > .scenario-waterfall-tag { display: block; }
  .scenario-waterfall-number { flex-direction: row; align-items: baseline; justify-content: flex-end; gap: 0.3rem; }
}

@media print {
  .scenario-walkthrough-toggle { display: none; }
  .scenario-walkthrough [hidden] { display: block; }
  .scenario-waterfall-row { break-inside: avoid; }
  .scenario-waterfall-bar { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
}
`;
