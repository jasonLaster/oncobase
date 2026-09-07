/** Serialized into experiment responses only. No imports or application runtime. */
export function bootHtmlFirstPage() {
  const host = document.getElementById("wiki-html-first");
  const root = document.getElementById("root");
  if (!host || !root) return;
  root.inert = true;
  // Let the inline-styled article paint before downloading/compiling the app
  // or applying its much larger stylesheet. Native links work immediately.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    document.querySelectorAll<HTMLLinkElement>("link[data-wiki-style-href]").forEach(link => {
      link.href = link.dataset.wikiStyleHref!;
    });
    document.querySelectorAll<HTMLLinkElement>("link[data-wiki-module-preload]").forEach(link => { link.rel = "modulepreload"; });
    document.querySelectorAll<HTMLScriptElement>("script[data-wiki-module-src]").forEach(placeholder => {
      const script = document.createElement("script");
      for (const attribute of placeholder.attributes) {
        if (attribute.name !== "type" && attribute.name !== "data-wiki-module-src") script.setAttribute(attribute.name, attribute.value);
      }
      script.type = "module"; script.src = placeholder.dataset.wikiModuleSrc!;
      placeholder.replaceWith(script);
    });
  }));
  const payload = document.getElementById("wiki-page-bootstrap");
  if (payload) payload.dataset.receivedAt = String(Date.now());
  const initialPath = location.pathname;
  const prefix = "wiki-html-";
  try {
    const width = Number.parseInt(localStorage.getItem("sidebar-width") ?? "256", 10);
    if (Number.isFinite(width) && width >= 0 && width <= 480) {
      host.style.setProperty("--html-sidebar-width", `${width === 0 ? 48 : width + 3}px`);
    }
    if (localStorage.getItem("comments-pane-open") === "1") {
      const pane = Number.parseInt(localStorage.getItem("comments-pane-width") ?? "384", 10);
      if (pane >= 240 && pane <= 640) host.querySelector<HTMLElement>(".wiki-shell-outline-root")
        ?.style.setProperty("--comments-pane-width", `${pane}px`);
    }
  } catch { /* Storage is optional. */ }
  let pointerDown = false;
  let finished = false;
  const check = () => {
    if (finished) return;
    const article = root.querySelector<HTMLElement>('[data-test-id="document-article"]');
    const routeChanged = location.pathname !== initialPath;
    const seeded = host.dataset.bootstrapSeeded === "true";
    const unavailable = seeded && article?.matches(".wiki-shell-empty-state, .wiki-shell-sensitive-unavailable");
    const selection = window.getSelection();
    if (!unavailable && !routeChanged && (pointerDown ||
        (selection && !selection.isCollapsed && host.contains(selection.anchorNode)))) return;
    if (!routeChanged && !unavailable && (!article?.querySelector(".wiki-markdown") ||
        article.dataset.documentSlug !== host.dataset.slug ||
        (!seeded && article.dataset.contentKey !== `${host.dataset.slug}:${host.dataset.hash}`))) return;
    // The article is styled inline. Keep it until the full app stylesheet is
    // applied, including when it is delayed or unavailable.
    if (!unavailable && !routeChanged && [...document.querySelectorAll<HTMLLinkElement>("link[data-wiki-full-style]")]
      .some(link => link.media !== "all" || !link.sheet)) return;

    // Preserve a keyboard reader's active link. If the lightweight navigation
    // has no live equivalent yet, wait for focus to leave it rather than steal it.
    const active = document.activeElement;
    let nextFocus: HTMLElement | undefined;
    if (active instanceof HTMLAnchorElement && host.contains(active)) {
      const href = active.getAttribute("href")?.replace(`#${prefix}`, "#");
      nextFocus = [...root.querySelectorAll<HTMLAnchorElement>("a[href]")]
        .find(link => link.getAttribute("href") === href);
      if (!nextFocus && !routeChanged && !unavailable) return;
    }
    const before = host.querySelector<HTMLElement>(".content-shell");
    const after = root.querySelector<HTMLElement>(".content-shell");
    if (before && after && !routeChanged) after.scrollTop = before.scrollTop;
    root.inert = false;
    host.remove();
    document.getElementById("wiki-html-first-style")?.remove();
    document.getElementById("wiki-critical-style")?.remove();
    nextFocus?.focus({ preventScroll: true });
    if (location.hash.startsWith(`#${prefix}`)) {
      history.replaceState(history.state, "", location.pathname + location.search + "#" + location.hash.slice(prefix.length + 1));
    }
    performance.mark("wiki-html-first-handoff");
    finished = true;
    observer.disconnect();
    window.removeEventListener("popstate", check);
    window.removeEventListener("wiki-full-style-ready", check);
    document.removeEventListener("selectionchange", check);
    window.removeEventListener("pointerup", release);
    window.removeEventListener("pointercancel", release);
  };
  const observer = new MutationObserver(check);
  observer.observe(root, { subtree: true, childList: true, attributes: true });
  host.addEventListener("pointerdown", () => { pointerDown = true; });
  const release = () => { pointerDown = false; setTimeout(check, 0); };
  window.addEventListener("pointerup", release);
  window.addEventListener("pointercancel", release);
  host.addEventListener("focusout", () => setTimeout(check, 0));
  window.addEventListener("popstate", check);
  window.addEventListener("wiki-full-style-ready", check);
  document.addEventListener("selectionchange", check);
  if (location.hash) {
    try {
      const id = decodeURIComponent(location.hash.slice(1));
      const target = document.getElementById(id.startsWith(prefix) ? id : prefix + id);
      if (target && host.contains(target)) target.scrollIntoView();
    } catch { /* Malformed fragments should not prevent startup. */ }
  }
  performance.mark("wiki-html-first-ready");
  check();
}
