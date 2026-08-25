import {
  formatDistanceMm,
  worldDistanceMm,
} from "./dicom-annotation-geometry.ts";
import {
  annotationKindLabel,
  type AnnotationSeriesResponse,
  type DicomAnnotation,
} from "./dicom-annotation-model.ts";
import type { ComparisonSide } from "./comparison-matching.ts";

export interface ComparisonAnnotationImage {
  fileName: string;
  instanceNumber: number | null;
  relativePath: string;
}

export interface ComparisonAnnotationTarget {
  annotation: DicomAnnotation;
  annotationId: string;
  detail: string;
  imageIndex: number;
  label: string;
  side: ComparisonSide;
}

export function comparisonAnnotationTargets(
  side: ComparisonSide,
  response: AnnotationSeriesResponse | undefined,
  images: ComparisonAnnotationImage[],
) {
  const targets: ComparisonAnnotationTarget[] = [];

  for (const annotatedImage of response?.images ?? []) {
    const annotationPath = annotatedImage.imageKey ?? annotatedImage.imagePath;
    if (!annotationPath) continue;
    const imageIndex = findAnnotationImageIndex(annotationPath, images);
    if (imageIndex < 0) continue;
    const image = images[imageIndex];
    if (!image) continue;

    for (const annotation of annotatedImage.annotations ?? []) {
      const distance =
        annotation.kind === "ruler"
          ? formatDistanceMm(worldDistanceMm(annotation))
          : null;
      targets.push({
        annotation,
        annotationId: annotation.id,
        detail: [
          distance,
          image.instanceNumber
            ? `image #${image.instanceNumber}`
            : image.fileName,
        ]
          .filter(Boolean)
          .join(" · "),
        imageIndex,
        label: annotation.text?.trim() || annotationKindLabel(annotation.kind),
        side,
      });
    }
  }

  return targets;
}

function findAnnotationImageIndex(
  annotationPath: string,
  images: ComparisonAnnotationImage[],
) {
  const exactIndex = images.findIndex(
    (image) => image.relativePath === annotationPath,
  );
  if (exactIndex >= 0) return exactIndex;

  const annotationFileName = fileName(annotationPath);
  return images.findIndex(
    (image) =>
      image.fileName === annotationFileName ||
      fileName(image.relativePath) === annotationFileName,
  );
}

function fileName(path: string) {
  return path.split(/[\\/]/).at(-1) ?? path;
}
