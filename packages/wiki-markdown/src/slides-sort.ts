type DateLikeImage = {
  src: string;
  alt?: string;
};

type SlideDateParts = {
  year?: number;
  month: number;
  day: number;
};

const MONTHS = new Map([
  ["jan", 1],
  ["january", 1],
  ["feb", 2],
  ["february", 2],
  ["mar", 3],
  ["march", 3],
  ["apr", 4],
  ["april", 4],
  ["may", 5],
  ["jun", 6],
  ["june", 6],
  ["jul", 7],
  ["july", 7],
  ["aug", 8],
  ["august", 8],
  ["sep", 9],
  ["sept", 9],
  ["september", 9],
  ["oct", 10],
  ["october", 10],
  ["nov", 11],
  ["november", 11],
  ["dec", 12],
  ["december", 12],
]);

function validDateParts(year: number, month: number, day: number) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function dateValue(year: number, month: number, day: number) {
  return validDateParts(year, month, day)
    ? Date.UTC(year, month - 1, day)
    : null;
}

function normalizeDateSource(image: DateLikeImage) {
  try {
    return decodeURIComponent(`${image.alt ?? ""} ${image.src}`);
  } catch {
    return `${image.alt ?? ""} ${image.src}`;
  }
}

export function extractSlideDateValue(image: DateLikeImage): number | null {
  const parts = extractSlideDateParts(image);
  return parts ? dateValue(parts.year ?? 2000, parts.month, parts.day) : null;
}

function extractSlideDateParts(image: DateLikeImage): SlideDateParts | null {
  const source = normalizeDateSource(image);

  const iso = source.match(/\b(19\d{2}|20\d{2})[-_./ ](0?[1-9]|1[0-2])[-_./ ](0?[1-9]|[12]\d|3[01])\b/);
  if (iso) {
    return {
      year: Number(iso[1]),
      month: Number(iso[2]),
      day: Number(iso[3]),
    };
  }

  const compactIso = source.match(/\b(19\d{2}|20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\b/);
  if (compactIso) {
    return {
      year: Number(compactIso[1]),
      month: Number(compactIso[2]),
      day: Number(compactIso[3]),
    };
  }

  const usWithYear = source.match(/\b(0?[1-9]|1[0-2])[-_./ ](0?[1-9]|[12]\d|3[01])[-_./ ](19\d{2}|20\d{2})\b/);
  if (usWithYear) {
    return {
      year: Number(usWithYear[3]),
      month: Number(usWithYear[1]),
      day: Number(usWithYear[2]),
    };
  }

  const monthName = source.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+([0-3]?\d)(?:,?\s+(19\d{2}|20\d{2}))?\b/i,
  );
  if (monthName) {
    const month = MONTHS.get(monthName[1]!.toLowerCase());
    if (month) {
      return {
        year: monthName[3] ? Number(monthName[3]) : undefined,
        month,
        day: Number(monthName[2]),
      };
    }
  }

  const usYearless = source.match(/(?:^|[^\d])(0?[1-9]|1[0-2])[-_./ ](0?[1-9]|[12]\d|3[01])(?:[^\d]|$)/);
  if (usYearless) {
    return {
      month: Number(usYearless[1]),
      day: Number(usYearless[2]),
    };
  }

  const compactYearless = source.match(/(?:^|[^\d])([1-9]|1[0-2])([0-3]\d)(?=[-_./ ][^\d]|$)/);
  if (compactYearless) {
    return {
      month: Number(compactYearless[1]),
      day: Number(compactYearless[2]),
    };
  }

  return null;
}

export function sortSlidesNewestFirst<T extends DateLikeImage>(images: T[]): T[] {
  const extracted = images.map((image, index) => ({
    image,
    index,
    parts: extractSlideDateParts(image),
  }));
  const inferredYear = extracted.reduce<number | null>((latest, { parts }) => {
    if (!parts?.year) return latest;
    return latest == null ? parts.year : Math.max(latest, parts.year);
  }, null);

  return images
    .map((image, index) => {
      const parts = extracted[index]?.parts;
      const year = parts?.year ?? inferredYear ?? 2000;
      return {
        dateValue: parts ? dateValue(year, parts.month, parts.day) : null,
        image,
        index,
      };
    })
    .sort((left, right) => {
      if (left.dateValue != null && right.dateValue != null) {
        return right.dateValue - left.dateValue || left.index - right.index;
      }
      if (left.dateValue != null) return -1;
      if (right.dateValue != null) return 1;
      return left.index - right.index;
    })
    .map(({ image }) => image);
}
