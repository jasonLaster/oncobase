type SlideImage = {
  src: string;
  alt: string;
};

const SLIDES_MARKER = /^\s*<!--\s*slides\s*-->\s*$/i;
const IMAGE_LIST_ITEM =
  /^\s*[-*+]\s+!\[([^\]]*)]\(([^)\s]+)(?:\s+"[^"]*")?\)\s*$/;

function escapeHtmlAttribute(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderSlidesHtml(images: SlideImage[]) {
  const slides = images
    .map((image, index) => {
      const hidden = index === 0 ? "" : " hidden";
      const active = index === 0 ? "true" : "false";
      const label = image.alt ? `Open image: ${image.alt}` : "Open image";
      return (
        `<li class="wiki-slides-viewer__slide" data-wiki-slide data-active="${active}"${hidden}>` +
        `<img src="${escapeHtmlAttribute(image.src)}" alt="${escapeHtmlAttribute(image.alt)}" ` +
        `data-theater-image role="button" tabindex="0" aria-label="${escapeHtmlAttribute(label)}">` +
        `</li>`
      );
    })
    .join("");

  return (
    `<figure class="wiki-slides-viewer" data-wiki-slides data-index="0">` +
    `<div class="wiki-slides-viewer__stage">` +
    `<ol class="wiki-slides-viewer__slides">${slides}</ol>` +
    `</div>` +
    `<div class="wiki-slides-viewer__controls">` +
    `<button class="wiki-slides-viewer__button" data-wiki-slides-prev type="button" aria-label="Previous slide" title="Previous slide"><span aria-hidden="true">&lt;</span></button>` +
    `<span class="wiki-slides-viewer__status" data-wiki-slides-status>1 / ${images.length}</span>` +
    `<button class="wiki-slides-viewer__button" data-wiki-slides-next type="button" aria-label="Next slide" title="Next slide"><span aria-hidden="true">&gt;</span></button>` +
    `</div>` +
    `</figure>`
  );
}

export function expandSlidesMarkdown(md: string): string {
  const lines = md.split(/\r?\n/);
  const output: string[] = [];

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? "";
    if (!SLIDES_MARKER.test(line)) {
      output.push(line);
      continue;
    }

    const images: SlideImage[] = [];
    let cursor = index + 1;

    while (cursor < lines.length) {
      const nextLine = lines[cursor] ?? "";
      if (!nextLine.trim()) {
        cursor += 1;
        continue;
      }

      const imageMatch = nextLine.match(IMAGE_LIST_ITEM);
      if (!imageMatch) break;

      images.push({
        alt: imageMatch[1] ?? "",
        src: imageMatch[2] ?? "",
      });
      cursor += 1;
    }

    if (images.length === 0) {
      output.push(line);
      continue;
    }

    output.push("", renderSlidesHtml(images), "");
    index = cursor - 1;
  }

  return output.join("\n");
}
