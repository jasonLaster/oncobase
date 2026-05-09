import { ActivityIcon, DatabaseIcon, FileTextIcon } from "lucide-react";
import type { Metrics } from "../types";
import { formatBytes } from "../wiki-utils";

export function MetricsPanel({ metrics }: { metrics: Metrics }) {
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
        <DatabaseIcon size={14} aria-hidden="true" />
        <span>storage</span>
        <strong>{formatBytes(metrics.opfsBytes)}</strong>
      </div>
    </div>
  );
}
