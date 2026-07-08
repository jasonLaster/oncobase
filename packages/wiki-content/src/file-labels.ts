const DATE_PREFIX_RE = /^(0[1-9]|1[0-2])-([0-2][0-9]|3[01])-+(.+)$/;
const ORDERING_PREFIX_RE = /^\d+-/;

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function ordinalDay(day: number) {
  const tens = day % 100;
  if (tens >= 11 && tens <= 13) return `${day}th`;

  switch (day % 10) {
    case 1:
      return `${day}st`;
    case 2:
      return `${day}nd`;
    case 3:
      return `${day}rd`;
    default:
      return `${day}th`;
  }
}

function wordsFromSlug(value: string) {
  return value.replace(/-/g, " ").replace(/\s+/g, " ").trim();
}

export function formatFileLabel(name: string): string {
  const dateMatch = name.match(DATE_PREFIX_RE);
  if (dateMatch) {
    const month = MONTH_NAMES[Number(dateMatch[1]) - 1];
    const day = ordinalDay(Number(dateMatch[2]));
    const label = wordsFromSlug(dateMatch[3]);
    return label ? `${month} ${day} - ${label}` : `${month} ${day}`;
  }

  return wordsFromSlug(name.replace(ORDERING_PREFIX_RE, ""));
}
