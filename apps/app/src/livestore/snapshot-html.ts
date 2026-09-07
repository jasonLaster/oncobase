import { persistFirstFrameSnapshot, retirePreviousFirstFrameSnapshot } from "./first-frame-snapshot";

export function persistSafeSnapshot(shell: HTMLElement, pathname: string, validatedAt: number) {
  const persisted = persistFirstFrameSnapshot(
    window.localStorage, window.location.origin,
    { html: snapshotSafeShell(shell), pathname }, { validatedAt },
  );
  if (persisted) retirePreviousFirstFrameSnapshot(window.localStorage, window.location.origin);
  return persisted;
}

export function snapshotSafeShell(shell: HTMLElement) {
  const clone = shell.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("script, iframe, object, embed").forEach((node) => {
    node.remove();
  });
  clone.querySelectorAll("*").forEach((node) => {
    for (const attribute of [...node.attributes]) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      if (
        name.startsWith("on") ||
        name === "srcdoc" ||
        ((name === "href" || name === "src" || name === "formaction") &&
          (value.startsWith("javascript:") ||
            value.startsWith("data:text/html")))
      ) {
        node.removeAttribute(attribute.name);
      }
    }
  });
  return clone.outerHTML;
}
