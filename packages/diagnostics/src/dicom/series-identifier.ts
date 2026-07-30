interface DicomSeriesIdentifier {
  id: string;
  seriesKey?: string;
}

export function matchesSeriesIdentifier(
  series: DicomSeriesIdentifier,
  identifier: string,
) {
  return series.id === identifier || series.seriesKey === identifier;
}
