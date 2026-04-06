"use client";

import {
  useRef,
  useEffect,
  type TextareaHTMLAttributes,
} from "react";

interface GrowingTextareaProps
  extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  value: string;
  maxHeight?: number;
  minRows?: number;
}

export function GrowingTextarea({
  value,
  maxHeight = 200,
  minRows = 1,
  className,
  style,
  ...props
}: GrowingTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Reset to min height to get accurate scrollHeight
    el.style.height = "auto";
    const newHeight = Math.min(el.scrollHeight, maxHeight);
    el.style.height = `${newHeight}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [value, maxHeight]);

  return (
    <textarea
      ref={ref}
      value={value}
      className={className}
      style={{ ...style, resize: "none" }}
      rows={minRows}
      {...props}
    />
  );
}
