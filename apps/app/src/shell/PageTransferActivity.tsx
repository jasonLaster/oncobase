import { usePageReceivedBytes } from "../sync/transfer-progress";
import { receivedLabel, useBrowserOnline, useSlowLoading } from "./ReaderStatus";

/** `transferSlug` selects whose byte progress to show once loading is slow. */
export function PageTransferActivity({ label, busy = true, transferSlug, onRetry }: {
  label: string; busy?: boolean; transferSlug?: string; onRetry?: () => void;
}) {
  const online = useBrowserOnline();
  const slow = useSlowLoading(busy && online);
  const receivedBytes = usePageReceivedBytes(transferSlug, slow);
  return <span className="reader-page-activity" data-test-id="page-activity" data-busy={busy && online}>
    <span role="status"><span className="reader-status-dot" aria-hidden="true" />{!online && busy ? "Offline · waiting for connection" : slow ? "Taking longer than usual…" : label}</span>
    {slow && receivedBytes > 0 ? <span className="reader-transfer-detail">{receivedLabel(receivedBytes)}</span> : null}
    {slow && onRetry ? <button type="button" className="reader-transfer-retry" onClick={onRetry}>Try again</button> : null}
  </span>;
}
