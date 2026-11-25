import { useEffect } from "react";

/**
 * Printed handouts must show folded content (`<details>`, foldable callouts):
 * open every closed `<details>` inside the article on `beforeprint` and close
 * exactly those again on `afterprint`. Lazy images below the fold would print
 * blank, so they switch to eager loading on `beforeprint`.
 */
export function usePrintExpandsDetails(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const opened: HTMLDetailsElement[] = [];
    const onBeforePrint = () => {
      const elements = document.querySelectorAll<HTMLDetailsElement | HTMLImageElement>(
        ".wiki-markdown :is(details:not([open]), img[loading=lazy])",
      );
      for (const element of elements) {
        if (element instanceof HTMLDetailsElement) {
          element.open = true;
          opened.push(element);
        } else {
          element.loading = "eager";
        }
      }
    };
    const onAfterPrint = () => {
      for (const details of opened.splice(0)) details.open = false;
    };
    window.addEventListener("beforeprint", onBeforePrint);
    window.addEventListener("afterprint", onAfterPrint);
    return () => {
      window.removeEventListener("beforeprint", onBeforePrint);
      window.removeEventListener("afterprint", onAfterPrint);
    };
  }, [enabled]);
}
