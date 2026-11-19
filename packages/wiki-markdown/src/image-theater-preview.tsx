"use client";

import { useEffect, useEffectEvent, useState, type ComponentProps } from "react";
import type { ImageTheaterModal } from "./image-theater-modal.tsx";

export function ImageTheaterPreview(props: ComponentProps<typeof ImageTheaterModal>) {
  const [Modal, setModal] = useState<typeof ImageTheaterModal | null>(null);
  const close = useEffectEvent(() => props.onClose());

  useEffect(() => {
    let active = true;
    void import("./image-theater-modal.tsx").then(({ ImageTheaterModal }) => {
      if (active) setModal(() => ImageTheaterModal);
    }).catch(() => {
      if (active) close();
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (Modal) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [Modal]);

  return Modal ? <Modal {...props} /> : null;
}
