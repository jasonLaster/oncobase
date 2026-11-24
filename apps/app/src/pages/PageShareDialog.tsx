import { useEffect, useState } from "react";
import { copyTextToClipboard } from "@oncobase/wiki-shell";
import { Button } from "@oncobase/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@oncobase/ui/dialog";
import { Input } from "@oncobase/ui/input";
import { toast } from "@oncobase/ui/toast";
import { X } from "lucide-react";
import { backendHref } from "../wiki-utils";
import "./page-sharing-styles";

export function PageShareDialog({ slug, title, onClose }: { slug: string; title: string; onClose: () => void }) {
  const [active, setActive] = useState(false);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
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
    return () => controller.abort();
  }, [slug]);

  const update = async (method: "POST" | "DELETE") => {
    setBusy(true); setError("");
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
    try { await copyTextToClipboard(link); toast.success("Link copied"); }
    catch { setError("Copy failed. Select the link and copy it manually."); }
  };

  return (
    <Dialog defaultOpen onOpenChangeComplete={open => { if (!open) onClose(); }}>
      <DialogContent className="page-share-dialog" finalFocus='[data-test-id="sensitive-page-lock"]'>
        <div className="page-share-heading">
          <DialogTitle>Share private page</DialogTitle>
          <DialogClose className="page-share-close" aria-label="Close sharing"><X size={18} /></DialogClose>
        </div>
        <p className="page-share-page-title">{title}</p>
        <DialogDescription>Anyone with the link can view this page.</DialogDescription>
        {error ? <p role="alert" className="page-share-error">{error}</p> : null}
        {!forbidden ? <>
          {link ? <div className="page-share-link">
            <Input aria-label="Secure link" value={link} readOnly onFocus={event => event.currentTarget.select()} />
            <Button className="page-share-primary" onClick={copy}>Copy link</Button>
          </div> : <p className="page-share-status" role="status">{busy ? "Loading…" : active ? "Link active. Replace it to copy a new link." : "No active link."}</p>}
          <div className="page-share-actions">
            <Button className={link ? "" : "page-share-primary"} disabled={busy} focusableWhenDisabled onClick={() => void update("POST")}>{active ? "Replace link" : "Create link"}</Button>
            {active ? <Button disabled={busy} focusableWhenDisabled onClick={() => void update("DELETE")}>Revoke link</Button> : null}
          </div>
        </> : null}
      </DialogContent>
    </Dialog>
  );
}
