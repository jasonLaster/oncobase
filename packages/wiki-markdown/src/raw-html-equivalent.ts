import { parse as parseCommas, stringify as commas } from "comma-separated-tokens";
import { find, html, normalize } from "property-information";
import { parse as parseSpaces, stringify as spaces } from "space-separated-tokens";
import { isRawComment, type HastNode } from "./raw-html.ts";

type PropertyValue = boolean | number | string | null | undefined | Array<number | string>;
type Properties = Record<string, PropertyValue>;

// hast-util-to-parse5's createProperty: a property as the attribute parse5 sees.
function toAttribute(key: string, value: PropertyValue): { name: string; value: string } | undefined {
  const info = find(html, key);
  if (
    value === false || value === null || value === undefined ||
    (typeof value === "number" && Number.isNaN(value)) ||
    (!value && info.boolean)
  ) return undefined;
  const flat = Array.isArray(value) ? (info.commaSeparated ? commas(value) : spaces(value)) : value;
  return { name: info.attribute, value: flat === true ? "" : String(flat) };
}

// hastscript's parsePrimitive and addProperty for the string value parse5 returns.
function parsePrimitive(info: ReturnType<typeof find>, value: string): number | string | boolean {
  if (info.number && value && !Number.isNaN(Number(value))) return Number(value);
  if ((info.boolean || info.overloadedBoolean) && (value === "" || normalize(value) === normalize(info.property))) return true;
  return value;
}

function fromAttribute(properties: Properties, name: string, value: string) {
  const info = find(html, name);
  let result: PropertyValue | boolean;
  if (info.spaceSeparated) result = parseSpaces(value);
  else if (info.commaSeparated) result = parseCommas(value);
  else if (info.commaOrSpaceSeparated) result = parseSpaces(parseCommas(value).join(" "));
  else result = parsePrimitive(info, value);
  if (Array.isArray(result)) result = result.map((item) => parsePrimitive(info, String(item)) as number | string);
  properties[info.property] = result;
}

/** Properties after rehype-raw's trip through HTML attributes: `true` on a
 * non-boolean attribute becomes `""`, `false` and nullish values drop, numbers
 * and token lists are re-parsed. */
export function roundTripProperties(properties: Properties): Properties {
  const result: Properties = {};
  for (const [key, value] of Object.entries(properties)) {
    const attribute = toAttribute(key, value);
    if (attribute) fromAttribute(result, attribute.name, attribute.value);
  }
  return result;
}

const TABLE_SECTIONS = new Set(["table", "thead", "tbody", "tfoot", "tr"]);

type HastElement = HastNode & { tagName?: string; properties?: Properties };

/** Whitespace text directly inside a table section, in document order. */
function takeTableWhitespace(node: HastElement, out: HastNode[]) {
  node.children = (node.children ?? []).filter((child: HastElement) => {
    if (child.type === "text") {
      out.push(child);
      return false;
    }
    if (child.type === "element" && TABLE_SECTIONS.has(child.tagName ?? "")) takeTableWhitespace(child, out);
    return true;
  });
}

/**
 * What rehype-raw does to a document whose only raw nodes are complete
 * comments, without parse5:
 * - Comments become comment nodes, which render nothing: drop them (react-markdown
 *   would otherwise print a raw node as text).
 * - hast-util-raw hands parse5 the line breaks between table rows and cells as
 *   ordinary characters, and the HTML parser foster-parents text out of a table
 *   section: they land in front of the table, in order. Do the same, so the
 *   rendered HTML stays byte-identical (renderer-raw-html.test.tsx).
 * - Properties pass through HTML attributes and back (`roundTripProperties`).
 */
export function rehypeRawEquivalent() {
  const visit = (node: HastElement) => {
    if (!node.children) return;
    const children: HastNode[] = [];
    for (const child of node.children as HastElement[]) {
      if (isRawComment(child)) continue;
      if (child.type === "element") {
        child.properties = roundTripProperties(child.properties ?? {});
        if (child.tagName === "table") takeTableWhitespace(child, children);
      }
      children.push(child);
      visit(child);
    }
    node.children = children;
  };
  return visit;
}
