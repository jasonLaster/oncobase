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
