"use client";

import { useId, useState } from "react";

type Pair<T> = readonly [T, T];
type Metric = { label: string; timing?: string };
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

function Impact({
  step, previous, metric, index, domain, last,
}: {
  step: Step;
  previous?: Step;
  metric: Metric;
  index: 0 | 1;
  domain: Pair<number>;
  last: boolean;
}) {
  const value = Number(step.values[index]);
  const from = previous ? Number(previous.values[index]) : domain[0];
  const total = !previous || step.kind === "total";
  const difference = Number((value - from).toFixed(2));
  const negative = difference < 0;
  const change = `${negative ? "−" : difference > 0 ? "+" : ""}${Math.abs(difference)} pp`;
  const position = (number: number) => (number - domain[0]) * 100 / (domain[1] - domain[0]);
  const end = position(value);
  const start = total ? 0 : position(from);
  const estimate = `${step.approximate?.[index] ? "≈" : ""}${step.values[index]}%`;

  return (
    <div
      className="scenario-waterfall-impact"
      role="cell"
      aria-label={`${metric.label}${metric.timing ? `, ${metric.timing}` : ""}: ${estimate}${total ? "" : `, ${change}`}`}
    >
      <span className="scenario-waterfall-mobile-label" aria-hidden="true">
        {metric.label}
        {metric.timing && <small>{metric.timing}</small>}
      </span>
      <div className="scenario-waterfall-value">
        <svg viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true">
          {[0, 25, 50, 75, 100].map(tick => (
            <line className="scenario-waterfall-gridline" key={tick} x1={tick} x2={tick} y2="32" />
          ))}
          {previous && <line className="scenario-waterfall-connector" x1={position(from)} x2={position(from)} y2="16" />}
          {!last && <line className="scenario-waterfall-connector" x1={end} x2={end} y1="16" y2="32" />}
          <line
            className={`scenario-waterfall-bar ${total ? "is-total" : negative ? "is-loss" : "is-gain"}`}
            x1={start} x2={end} y1="16" y2="16"
          />
          <circle className="scenario-waterfall-point" cx={end} cy="16" r="1" />
        </svg>
        <span className="scenario-waterfall-number" aria-hidden="true">
          <strong>{estimate}</strong>
          {!total && <small className={negative ? "is-loss" : "is-gain"}>{change}</small>}
        </span>
      </div>
    </div>
  );
}

export default function ScenarioWaterfall({ metrics, scenarios, domain = [0, 100] }: ScenarioWaterfallProps) {
  const selectId = useId();
  const [selected, setSelected] = useState<string>();
  const scenario: Scenario | undefined = Array.isArray(scenarios)
    ? scenarios.find(item => item?.id === selected) ?? scenarios[0]
    : undefined;

  if (!scenario || !Array.isArray(scenario.steps as unknown) || !scenario.steps.length ||
      !Array.isArray(metrics) || metrics.length !== 2 || metrics.some(metric => !metric?.label) ||
      !Array.isArray(domain) || !Number.isFinite(domain[0]) || !Number.isFinite(domain[1]) || domain[0] >= domain[1] ||
      scenario.steps.some(step => !Array.isArray(step?.values as unknown) || step.values.length !== 2 || step.values.some(value =>
        !/^\d+(?:\.\d{1,2})?$/.test(value) || Number(value) < domain[0] || Number(value) > domain[1]
      ))) {
    return <p role="note">This waterfall has no valid scenario data.</p>;
  }

  return (
    <div className="scenario-waterfall">
      <style href="scenario-waterfall" precedence="default">{styles}</style>
      {scenarios.length > 1 && (
        <div className="scenario-waterfall-control">
          <label htmlFor={selectId}>Scenario</label>
          <select id={selectId} value={scenario.id} onChange={event => setSelected(event.currentTarget.value)}>
            {scenarios.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </div>
      )}
      {scenario.note && <p className="scenario-waterfall-note">{scenario.note}</p>}
      <div role="table" aria-label={scenario.label}>
        <div className="scenario-waterfall-row scenario-waterfall-head" role="row">
          <div role="columnheader">Model step</div>
          {metrics.map(metric => (
            <div role="columnheader" key={metric.label}>
              <strong>{metric.label}</strong>
              {metric.timing && <small>{metric.timing}</small>}
              <div className="scenario-waterfall-axis" aria-hidden="true"><span>{domain[0]}%</span><span>{domain[1]}%</span></div>
            </div>
          ))}
        </div>
        {scenario.steps.map((step, index) => (
          <div className={`scenario-waterfall-row${step.kind === "total" ? " is-result" : ""}`} role="row" key={step.label}>
            <div className="scenario-waterfall-step" role="rowheader">
              <strong>{step.label}</strong>
              {step.detail && <p>{step.detail}</p>}
            </div>
            <Impact step={step} previous={scenario.steps[index - 1]} metric={metrics[0]} index={0} domain={domain} last={index === scenario.steps.length - 1} />
            <Impact step={step} previous={scenario.steps[index - 1]} metric={metrics[1]} index={1} domain={domain} last={index === scenario.steps.length - 1} />
          </div>
        ))}
      </div>
      <p className="scenario-waterfall-key">
        Read from top to bottom. Floating bars show changes from the previous estimate in percentage points (pp).
        The scale spans {domain[0]}–{domain[1]}%. Changes are calculated from the displayed estimates.
      </p>
    </div>
  );
}

// Keep these styles with the lazy MDX component so other pages do not download them.
const styles = `
.scenario-waterfall {
  --waterfall-line: color-mix(in srgb, currentColor 17%, transparent);
  --waterfall-up: light-dark(#1a6858, #6ed4b0);
  --waterfall-down: light-dark(#a2402e, #ffad96);
  --waterfall-total: light-dark(#455d98, #a4b9fb);
  container-type: inline-size;
}

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

.scenario-waterfall-control select:focus-visible {
  outline: 2px solid var(--waterfall-total);
  outline-offset: 2px;
}

.scenario-waterfall-row {
  display: grid;
  grid-template-columns: minmax(0, 2fr) repeat(2, minmax(0, 1fr));
  border-bottom: 1px solid var(--waterfall-line);
}

.scenario-waterfall-row > div { padding: 0.55rem 0.625rem; }
.scenario-waterfall-head, .scenario-waterfall-row.is-result {
  background: color-mix(in srgb, currentColor 5%, transparent);
}

.scenario-waterfall-head {
  font-size: 0.8rem;
  font-weight: 650;
  border-top: 1px solid var(--waterfall-line);
}

.scenario-waterfall-head small,
.scenario-waterfall-axis,
.scenario-waterfall-number small { font-size: 0.75rem; }

.scenario-waterfall-head small,
.scenario-waterfall-number small { display: block; font-weight: 500; }

.scenario-waterfall-axis {
  display: flex;
  justify-content: space-between;
  width: calc(100% - 3.5rem);
  margin-top: 0.25rem;
  font-variant-numeric: tabular-nums;
}

.scenario-waterfall-step { overflow-wrap: anywhere; }
.wiki-markdown .scenario-waterfall-step p,
.scenario-waterfall-step p {
  margin: 0.18rem 0 0;
  font-size: 0.85rem;
  line-height: 1.45;
}

.scenario-waterfall-row .scenario-waterfall-impact {
  min-width: 0;
  padding-block: 0;
  display: grid;
}

.scenario-waterfall-value {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 3.5rem;
  align-items: center;
}

.scenario-waterfall-number {
  text-align: right;
  white-space: nowrap;
  font-size: 0.9rem;
  font-variant-numeric: tabular-nums;
}

.scenario-waterfall-value svg {
  width: 100%;
  height: 100%;
  min-height: 1.5rem;
  overflow: visible;
}

.scenario-waterfall-gridline, .scenario-waterfall-connector, .scenario-waterfall-bar {
  vector-effect: non-scaling-stroke;
}

.scenario-waterfall-gridline { stroke: var(--waterfall-line); }
.scenario-waterfall-connector {
  stroke: currentColor;
  stroke-opacity: 0.5;
  stroke-dasharray: 2 2;
}
.scenario-waterfall-bar { stroke: currentColor; stroke-width: 6; }
.scenario-waterfall-point { fill: currentColor; }
.scenario-waterfall-bar.is-total { color: var(--waterfall-total); }
.scenario-waterfall-bar.is-gain, .scenario-waterfall-number .is-gain { color: var(--waterfall-up); }
.scenario-waterfall-bar.is-loss, .scenario-waterfall-number .is-loss { color: var(--waterfall-down); }
.scenario-waterfall-mobile-label { display: none; }
.scenario-waterfall-note, .scenario-waterfall-key { font-size: 0.85rem; }

@container (max-width: 35rem) {
  .scenario-waterfall-head { display: none; }
  .scenario-waterfall-row { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .scenario-waterfall-step { grid-column: 1 / -1; }
  .scenario-waterfall-row .scenario-waterfall-impact { padding-block: 0 0.55rem; }
  .scenario-waterfall-mobile-label { display: block; font-size: 0.75rem; }
  .scenario-waterfall-mobile-label small { display: block; font-size: 0.6875rem; }
  .scenario-waterfall-connector { display: none; }
  .scenario-waterfall-value svg { height: 1.5rem; align-self: center; }
}
`;
