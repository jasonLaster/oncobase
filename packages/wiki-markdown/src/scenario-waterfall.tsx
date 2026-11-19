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

export function ScenarioWaterfall({ metrics, scenarios, domain = [0, 100] }: ScenarioWaterfallProps) {
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
