import type {
  AnnotationSeriesResponse,
  DicomAnnotation,
  DicomAnnotationImage,
} from "./dicom-annotation-model.ts";

export function imageKey(image: DicomAnnotationImage) {
  return image.relativePath;
}

export function loadAnnotationsMap(response: AnnotationSeriesResponse) {
  const next: Record<string, DicomAnnotation[]> = {};
  for (const image of response.images ?? []) {
    const key = image.imageKey ?? image.imagePath;
    if (!key) continue;
    next[key] = image.annotations ?? [];
  }
  return next;
}

export function annotationsForImage(
  annotationsByImage: Record<string, DicomAnnotation[]>,
  image: DicomAnnotationImage | null,
) {
  if (!image) return [];
  const exact = annotationsByImage[imageKey(image)];
  if (exact) return exact;

  const matchingPath = Object.keys(annotationsByImage).find(
    (path) => fileName(path) === image.fileName,
  );
  return matchingPath ? annotationsByImage[matchingPath] ?? [] : [];
}

function fileName(path: string) {
  return path.split(/[\\/]/).at(-1) ?? path;
}
