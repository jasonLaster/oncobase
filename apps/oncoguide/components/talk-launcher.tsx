"use client";
import dynamic from "next/dynamic";
import { useState } from "react";
import { TalkAvatar } from "./talk-avatar";

const loadPanel = () => import("./talk-panel").then(module => module.TalkPanel);
const TalkPanel = dynamic(loadPanel, { ssr: false });

/** Lives in the root layout, so a call survives client-side page changes. The
 * call code, including the library search, loads only when a reader opens it. */
export function TalkLauncher() {
  const [open, setOpen] = useState(false);
  const [returnFocus, setReturnFocus] = useState(false);
  if (open) return <TalkPanel onClose={() => { setOpen(false); setReturnFocus(true); }} />;
  return <div className="edu-talk">
    <button type="button" className="edu-talk-launcher" autoFocus={returnFocus} onClick={() => setOpen(true)} onPointerEnter={() => void loadPanel()} onFocus={() => void loadPanel()}>
      <TalkAvatar state="idle" />
      <span>Talk with OncoGuide</span>
    </button>
  </div>;
}
