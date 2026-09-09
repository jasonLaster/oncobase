/** Run in the head so streamed mobile navigation cannot cover the first paint. */
export function prepareHtmlFirstPresentation() {
  if (!window.matchMedia("(max-width: 767px)").matches) return;
  const closeInitialTree = () => {
    const files = document.querySelector("#wiki-html-first .html-first-files");
    if (!files) return false;
    files.removeAttribute("open");
    return true;
  };
  if (closeInitialTree()) return;
  const observer = new MutationObserver(() => {
    if (closeInitialTree()) observer.disconnect();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
