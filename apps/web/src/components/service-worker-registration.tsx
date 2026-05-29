"use client";

import { useEffect } from "react";

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (
      process.env.NODE_ENV !== "production" ||
      !("serviceWorker" in navigator)
    ) {
      return;
    }

    let idleCallbackId: number | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const register = () => {
      void navigator.serviceWorker
        .register("/sw.js", {
          scope: "/",
          updateViaCache: "none",
        })
        .catch((error) => {
          console.warn("[service-worker] registration failed", error);
        });
    };

    if ("requestIdleCallback" in window) {
      idleCallbackId = window.requestIdleCallback(register, { timeout: 2000 });
    } else {
      timeoutId = setTimeout(register, 1000);
    }

    return () => {
      if (idleCallbackId !== null) {
        window.cancelIdleCallback(idleCallbackId);
      }
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
    };
  }, []);

  return null;
}
