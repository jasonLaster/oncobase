import { useEffect } from "react";

/**
 * Printed handouts must show folded content (`<details>`, foldable callouts):
 * open every closed `<details>` inside the article on `beforeprint` and close
 * exactly those again on `afterprint`. Lazy images below the fold would print
 * blank, so they switch to eager loading on `beforeprint`.
 */
export function usePrintExpandsDetails(selector = ".wiki-markdown"): void {
  useEffect(() => {
    let opened: HTMLDetailsElement[] = [];
    const onBeforePrint = () => {
      opened = [];
      for (const root of document.querySelectorAll(selector)) {
        for (const details of root.querySelectorAll<HTMLDetailsElement>("details:not([open])")) {
          details.open = true;
          opened.push(details);
        }
        for (const image of root.querySelectorAll<HTMLImageElement>('img[loading="lazy"]')) {
          image.loading = "eager";
        }
      }
    };
    const onAfterPrint = () => {
      for (const details of opened) details.open = false;
      opened = [];
    };
    window.addEventListener("beforeprint", onBeforePrint);
    window.addEventListener("afterprint", onAfterPrint);
    return () => {
      window.removeEventListener("beforeprint", onBeforePrint);
      window.removeEventListener("afterprint", onAfterPrint);
    };
  }, [selector]);
}
