import { ActivityIcon, ClockIcon, DatabaseIcon, FileTextIcon, WifiOffIcon } from "lucide-react";
import type { Metrics } from "../types";
import { formatBytes, formatPercent } from "../wiki-utils";

function formatMs(value: number | null) {
  if (value == null) return "pending";
  if (value < 1000) return `${Math.max(1, Math.round(value))} ms`;
  return `${(value / 1000).toFixed(1)} s`;
}

export function MetricsPanel({ metrics }: { metrics: Metrics }) {
  const storageRatio =
    metrics.opfsBytes != null && metrics.storageQuotaBytes != null && metrics.storageQuotaBytes > 0
      ? metrics.opfsBytes / metrics.storageQuotaBytes
      : null;

  return (
    <div className="metrics-panel">
      <div>
        <DatabaseIcon size={14} aria-hidden="true" />
        <span>manifest</span>
        <strong>{formatBytes(metrics.manifestBytes)}</strong>
      </div>
      <div>
        <FileTextIcon size={14} aria-hidden="true" />
        <span>markdown</span>
        <strong>{formatBytes(metrics.markdownBytes)}</strong>
      </div>
      <div>
        <ActivityIcon size={14} aria-hidden="true" />
        <span>events</span>
        <strong>{metrics.eventCount}</strong>
      </div>
      <div>
        <ClockIcon size={14} aria-hidden="true" />
        <span>route</span>
        <strong>{formatMs(metrics.lastRouteRenderMs)}</strong>
      </div>
      <div>
        <ClockIcon size={14} aria-hidden="true" />
        <span>warm</span>
        <strong>{formatMs(metrics.warmRouteRenderMs)}</strong>
      </div>
      <div>
        <DatabaseIcon size={14} aria-hidden="true" />
        <span>storage</span>
        <strong
          title={
            metrics.storageQuotaBytes == null
              ? undefined
              : `${formatBytes(metrics.opfsBytes)} of ${formatBytes(metrics.storageQuotaBytes)}`
          }
        >
          {formatBytes(metrics.opfsBytes)}
        </strong>
      </div>
      {metrics.storagePressure === "warning" || metrics.storagePressure === "critical" ? (
        <div className={`storage-pressure ${metrics.storagePressure}`}>
          <DatabaseIcon size={14} aria-hidden="true" />
          <span>cache pressure</span>
          <strong>{formatPercent(storageRatio)}</strong>
        </div>
      ) : null}
      <div>
        <WifiOffIcon size={14} aria-hidden="true" />
        <span>body misses</span>
        <strong>{metrics.failedBodyFetches}</strong>
      </div>
    </div>
  );
}
