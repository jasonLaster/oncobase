export type TheaterImageItem = {
  src: string;
  alt: string;
};

export type TheaterImageState = TheaterImageItem & {
  images?: TheaterImageItem[];
  index?: number;
};

export function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function getDownloadName(src: string) {
  try {
    const url = new URL(src, window.location.href);
    const proxiedPath = url.searchParams.get("path");
    const filePath = proxiedPath ? decodeURIComponent(proxiedPath) : url.pathname;
    return filePath.split("/").filter(Boolean).pop() ?? "image";
  } catch {
    return "image";
  }
}

function isVisibleImage(image: HTMLImageElement) {
  const rect = image.getBoundingClientRect();
  const style = window.getComputedStyle(image);

  return (
    rect.width > 0 &&
    rect.height > 0 &&
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    style.opacity !== "0"
  );
}

function imageItemFromElement(
  image: HTMLImageElement,
  { requireVisible = false }: { requireVisible?: boolean } = {},
): TheaterImageItem | null {
  const src = image.currentSrc || image.src;
  if (!src || (requireVisible && !isVisibleImage(image))) return null;

  return {
    src,
    alt: image.alt || "Image preview",
  };
}

export function imageStateFromElement(image: HTMLImageElement): TheaterImageState | null {
  const item = imageItemFromElement(image, { requireVisible: true });
  if (!item) return null;

  const viewer = image.closest<HTMLElement>("[data-wiki-slides]");
  if (!viewer) return item;

  const slideImages = Array.from(
    viewer.querySelectorAll<HTMLImageElement>("[data-wiki-slide] img"),
  );
  const images = slideImages
    .map((slideImage) => imageItemFromElement(slideImage))
    .filter((slideImage): slideImage is TheaterImageItem => Boolean(slideImage));
  const index = Math.max(0, slideImages.indexOf(image));

  return images.length > 1 ? { ...item, images, index } : item;
}
