import { useEffect, useRef, useState } from "react";
import { copyTextToClipboard } from "@oncobase/wiki-shell";
import { X } from "lucide-react";
import { backendHref } from "../wiki-utils";
import "./page-sharing.css";

export function PageShareDialog({ slug, title, onClose }: { slug: string; title: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [active, setActive] = useState(false);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const element = dialog.current!;
    const previousFocus = document.activeElement as HTMLElement | null;
    element.showModal();
    const controller = new AbortController();
    void fetch(backendHref("/api/page-shares", { slug }), { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const data = await response.json();
        if (controller.signal.aborted) return;
        if (!response.ok) {
          setForbidden(response.status === 403);
          throw new Error(data.error || "Sharing could not be loaded.");
        }
        setActive(data.active);
      }).catch(error => { if (!controller.signal.aborted) setError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => { controller.abort(); element.close(); previousFocus?.focus(); };
  }, [slug]);

  const update = async (method: "POST" | "DELETE") => {
    setBusy(true); setError(""); setCopied(false);
    try {
      const response = await fetch(backendHref("/api/page-shares"), { method,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Sharing could not be updated.");
      setActive(data.active); setLink(data.url ?? "");
    } catch (error) { setError(error instanceof Error ? error.message : "Sharing could not be updated."); }
    finally { setBusy(false); }
  };

  const copy = async () => {
    try { await copyTextToClipboard(link); setCopied(true); }
    catch { setError("Copy failed. Select the link and copy it manually."); }
  };

  return (
    <dialog ref={dialog} className="page-share-dialog" aria-labelledby="page-share-title"
      aria-describedby="page-share-description" onCancel={onClose}
      onClick={event => { if (event.target === dialog.current) onClose(); }}>
      <div className="page-share-heading">
        <h2 id="page-share-title">Share private page</h2>
        <button className="page-share-close" aria-label="Close sharing" onClick={onClose}><X size={18} /></button>
      </div>
      <p className="page-share-page-title">{title}</p>
      <p id="page-share-description">Anyone with the link can view this page.</p>
      {error ? <p role="alert" className="page-share-error">{error}</p> : null}
      {!forbidden ? <>
        {link ? <div className="page-share-link">
          <input aria-label="Secure link" value={link} readOnly onFocus={event => event.target.select()} />
          <button className="page-share-primary" onClick={copy}>{copied ? "Copied" : "Copy link"}</button>
        </div> : <p className="page-share-status" role="status">{busy ? "Loading…" : active ? "Link active. Replace it to copy a new link." : "No active link."}</p>}
        <div className="page-share-actions">
          <button className={link ? "" : "page-share-primary"} disabled={busy} onClick={() => void update("POST")}>{active ? "Replace link" : "Create link"}</button>
          {active ? <button disabled={busy} onClick={() => void update("DELETE")}>Revoke link</button> : null}
        </div>
      </> : null}
    </dialog>
  );
}
