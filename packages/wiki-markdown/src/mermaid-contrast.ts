/**
 * Keeps Mermaid node labels readable when authors set a node fill (via
 * `style` or `classDef`) without a matching text colour. The theme's text
 * colour is tuned for the theme's own node fill, so a pastel `fill:#ffd6d6`
 * under a dark theme ends up with near-white text on a near-white box.
 *
 * Both renderers use this: the client Mermaid renderer (apps/app readers)
 * and the server beautiful-mermaid renderer (OncoGuide static export).
 */

export type Rgb = [number, number, number];

export const DARK_LABEL_TEXT = "#0f172a";
export const LIGHT_LABEL_TEXT = "#f8fafc";
/** WCAG AA for normal-size text. */
export const MIN_LABEL_CONTRAST = 4.5;

const NAMED: Record<string, Rgb> = {
  white: [255, 255, 255],
  black: [0, 0, 0],
};

export function parseCssColor(value: string | null | undefined): Rgb | null {
  if (!value) return null;
  const color = value.replace(/!important/i, "").trim().toLowerCase();
  if (color in NAMED) return NAMED[color];

  const hex = color.match(/^#([0-9a-f]{3,8})$/);
  if (hex) {
    let digits = hex[1];
    if (digits.length === 3 || digits.length === 4) {
      digits = digits
        .split("")
        .map((digit) => digit + digit)
        .join("");
    }
    if (digits.length !== 6 && digits.length !== 8) return null;
    if (digits.length === 8 && Number.parseInt(digits.slice(6, 8), 16) < 128) {
      return null;
    }
    return [
      Number.parseInt(digits.slice(0, 2), 16),
      Number.parseInt(digits.slice(2, 4), 16),
      Number.parseInt(digits.slice(4, 6), 16),
    ];
  }

  const rgb = color.match(/^rgba?\(([^)]+)\)$/);
  if (rgb) {
    const parts = rgb[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if (parts.length < 3 || parts.slice(0, 3).some((part) => !Number.isFinite(part))) {
      return null;
    }
    if (parts.length >= 4 && parts[3] < 0.5) return null;
    return [parts[0], parts[1], parts[2]];
  }

  return null;
}

function channel(value: number): number {
  const srgb = value / 255;
  return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance([r, g, b]: Rgb): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** The label colour (dark or light) with the higher contrast against `fill`. */
export function readableTextColor(fill: Rgb): string {
  const dark = parseCssColor(DARK_LABEL_TEXT) as Rgb;
  const light = parseCssColor(LIGHT_LABEL_TEXT) as Rgb;
  return contrastRatio(fill, dark) >= contrastRatio(fill, light)
    ? DARK_LABEL_TEXT
    : LIGHT_LABEL_TEXT;
}

/**
 * Returns the colour a label should switch to, or null when the current text
 * colour already reads well on `fill` (so authored colours are respected).
 */
export function labelColorFix(
  fill: string | null | undefined,
  text: string | null | undefined,
): string | null {
  const fillRgb = parseCssColor(fill);
  if (!fillRgb) return null;
  const textRgb = parseCssColor(text);
  if (textRgb && contrastRatio(fillRgb, textRgb) >= MIN_LABEL_CONTRAST) return null;
  return readableTextColor(fillRgb);
}

function readableTextColorFor(fill: string): string | null {
  const rgb = parseCssColor(fill);
  return rgb ? readableTextColor(rgb) : null;
}

const NODE_GROUP = /<g class="node"[^>]*>[\s\S]*?<\/g>/g;
const SHAPE_FILL =
  /<(?:rect|polygon|circle|ellipse|path)\b[^>]*?\sfill="([^"]+)"/;
const TEXT_TAG = /<text\b[^>]*>/g;

/**
 * Server-side pass over a beautiful-mermaid SVG string. `themeText` is the
 * colour `var(--_text)` resolves to in that theme; omit it when the theme
 * itself is CSS variables, and theme-coloured labels on authored fills always
 * get the readable colour for that fill.
 */
export function fixMermaidSvgContrast(svg: string, themeText?: string): string {
  return svg.replace(NODE_GROUP, (group) => {
    const shapeFill = group.match(SHAPE_FILL)?.[1];
    if (!shapeFill || shapeFill.startsWith("var(")) return group;
    return group.replace(TEXT_TAG, (tag) => {
      const current = tag.match(/\sfill="([^"]+)"/)?.[1];
      const resolved = !current || current.startsWith("var(") ? themeText : current;
      const fix = resolved
        ? labelColorFix(shapeFill, resolved)
        : readableTextColorFor(shapeFill);
      if (!fix) return tag;
      return current
        ? tag.replace(/\sfill="[^"]+"/, ` fill="${fix}"`)
        : tag.replace(/^<text\b/, `<text fill="${fix}"`);
    });
  });
}
