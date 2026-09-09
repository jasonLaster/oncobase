/** Serialized into experiment responses only. No imports or application runtime. */
export function bootHtmlFirstPage() {
  const copyButton = document.querySelector<HTMLButtonElement>("#wiki-html-first [data-reader-copy]");
  const copyPayload = document.getElementById("wiki-page-bootstrap");
  if (copyButton && copyPayload && navigator.clipboard?.writeText) {
    try {
      const page = JSON.parse(copyPayload.textContent ?? "null")?.page;
      if (typeof page?.title === "string" && typeof page?.content === "string") {
        copyButton.disabled = false;
        copyButton.title = "Copy as markdown";
        copyButton.addEventListener("click", async () => {
          try {
            await navigator.clipboard.writeText(`# ${page.title}\n\n${page.content}`);
            copyButton.title = "Copied";
          } catch { copyButton.title = "Unable to copy"; }
        });
      }
    } catch { /* Invalid bootstrap data must not enable a copy action. */ }
  }
  const host = document.getElementById("wiki-html-first");
  const root = document.getElementById("root");
  if (!host || !root) return;
  root.inert = true;
  let departing = false;
  const markDeparting = () => { departing = true; };
  const resume = () => { departing = false; };
  window.addEventListener("beforeunload", markDeparting);
  window.addEventListener("pageshow", resume);
  // Let the inline-styled article paint before downloading/compiling the app
  // or applying its much larger stylesheet. Native links work immediately.
  const recoverLoad = (build: string) => {
    // Firefox/WebKit report canceled module downloads as load errors during
    // native navigation. Retrying then reloads the article and cancels the click.
    if (departing || !host.isConnected) return;
    const key = "wiki-vite:reloaded-for-load-error";
    try {
      if (sessionStorage.getItem(key) !== build) {
        sessionStorage.setItem(key, build);
        location.reload();
        return;
      }
    } catch { /* Keep native reading and a manual retry when storage is denied. */ }
    if (!host.isConnected || host.querySelector('[data-reader-load-error]')) return;
    const notice = document.createElement("p");
    notice.dataset.readerLoadError = "true";
    notice.setAttribute("role", "alert");
    notice.textContent = "The interactive reader could not load. ";
    const retry = document.createElement("a");
    retry.href = location.href;
    retry.textContent = "Reload";
    notice.append(retry);
    host.querySelector("nav")?.prepend(notice);
  };
  let appStarted = false;
  const startApp = () => {
    if (appStarted) return;
    appStarted = true;
    document.querySelectorAll<HTMLLinkElement>("link[data-wiki-module-preload]").forEach(link => { link.rel = "modulepreload"; });
    document.querySelectorAll<HTMLScriptElement>("script[data-wiki-module-src]").forEach(placeholder => {
      const script = document.createElement("script");
      for (const attribute of placeholder.attributes) {
        if (attribute.name !== "type" && attribute.name !== "data-wiki-module-src") script.setAttribute(attribute.name, attribute.value);
      }
      script.type = "module"; script.src = placeholder.dataset.wikiModuleSrc!;
      script.addEventListener("error", () => recoverLoad(script.getAttribute("src")!));
      placeholder.replaceWith(script);
    });
  };
  requestAnimationFrame(() => requestAnimationFrame(startApp));
  // Background tabs may not receive animation frames. They still need to boot.
  setTimeout(startApp, 100);
  for (const id of ["wiki-page-bootstrap", "wiki-navigation-bootstrap"]) {
    const payload = document.getElementById(id);
    if (payload) payload.dataset.receivedAt = String(Date.now());
  }
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
    const recovery = root.querySelector('[data-test-id="app-recovery"], [data-test-id="session-recovery"], [data-test-id="store-startup-recovery"]');
    const unavailable = article?.dataset.readerUnavailable === "true" || !!recovery;
    const palette = root.querySelector<HTMLElement>('[data-test-id="command-palette"]');
    const selection = window.getSelection();
    if (!palette && !unavailable && !routeChanged && (pointerDown ||
        (selection && !selection.isCollapsed && host.contains(selection.anchorNode)))) return;
    if (!routeChanged && !unavailable && (!article?.querySelector(".wiki-markdown") ||
        article.dataset.documentSlug !== host.dataset.slug ||
        (!seeded && article.dataset.contentKey !== `${host.dataset.slug}:${host.dataset.hash}` &&
          !article.querySelector('[data-reader-ready="true"]')))) return;
    // Preserve a keyboard reader's active link. If the lightweight navigation
    // has no live equivalent yet, wait for focus to leave it rather than steal it.
    const active = document.activeElement;
    let nextFocus: HTMLElement | undefined;
    if (!palette && active === copyButton) {
      nextFocus = root.querySelector<HTMLElement>('[aria-label="Copy page as markdown"]') ?? undefined;
      if (!nextFocus) return;
    }
    if (!palette && active instanceof HTMLAnchorElement && host.contains(active)) {
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
    // The complete compiled stylesheet also styles the interactive app.
    nextFocus?.focus({ preventScroll: true });
    // A requested dialog can mount while the root is still inert. Its initial
    // focus attempt cannot succeed until the retained article is released.
    palette?.querySelector<HTMLElement>("input")?.focus({ preventScroll: true });
    if (location.hash.startsWith(`#${prefix}`)) {
      history.replaceState(history.state, "", location.pathname + location.search + "#" + location.hash.slice(prefix.length + 1));
    }
    performance.mark("wiki-html-first-handoff");
    finished = true;
    observer.disconnect();
    window.removeEventListener("beforeunload", markDeparting);
    window.removeEventListener("pageshow", resume);
    window.removeEventListener("popstate", check);

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

  document.addEventListener("selectionchange", check);
  const restoreFragment = () => {
    if (!location.hash) return;
    try {
      const id = decodeURIComponent(location.hash.slice(1));
      const target = document.getElementById(id.startsWith(prefix) ? id : prefix + id);
      if (target && host.contains(target)) target.scrollIntoView();
    } catch { /* Malformed fragments should not prevent startup. */ }
  };
  restoreFragment();
  const rest = document.getElementById("wiki-html-first-rest");
  if (rest) {
    // Give the opening text several frames before constructing thousands of
    // offscreen nodes. This work is independent of successful app startup.
    let frames = 4;
    const expand = () => {
      if (!host.isConnected) return;
      if (--frames > 0) { requestAnimationFrame(expand); return; }
      setTimeout(() => {
        if (!rest.isConnected) return;
        const template = document.createElement("template");
        template.innerHTML = rest.textContent ?? "";
        rest.replaceWith(template.content);
        restoreFragment();
        // content-visibility replaces estimated heights as the destination
        // becomes visible; align the fragment again after that layout.
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (host.isConnected && !pointerDown) restoreFragment();
        }));
      }, 0);
    };
    requestAnimationFrame(expand);
  }
  performance.mark("wiki-html-first-ready");
  check();
}
