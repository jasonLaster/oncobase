import { createElement, type ReactNode } from "react";
import { figureTableData, parseFigureSpec, type FigureSpec } from "./figure-spec.ts";
import { buildFigureSvgNode, type SvgChild } from "./figure-svg.ts";

const SVG_ATTR_TO_REACT: Record<string, string> = {
  class: "className",
  "font-size": "fontSize",
  "font-weight": "fontWeight",
  "text-anchor": "textAnchor",
  "stroke-width": "strokeWidth",
};

function svgNodeToReact(node: SvgChild, key: number): ReactNode {
  if (typeof node === "string") return node;
  const props: Record<string, unknown> = { key };
  if (node.attrs) {
    for (const [attr, value] of Object.entries(node.attrs)) {
      if (value === undefined) continue;
      props[SVG_ATTR_TO_REACT[attr] ?? attr] = value;
    }
  }
  const children = node.children?.map((child, idx) => svgNodeToReact(child, idx));
  return createElement(node.tag, props, ...(children ?? []));
}

export function FigureSvg({ spec }: { spec: FigureSpec }) {
  return svgNodeToReact(buildFigureSvgNode(spec), 0);
}

export function FigureAccessibleTable({
  spec,
  visuallyHidden,
}: {
  spec: FigureSpec;
  visuallyHidden?: boolean;
}) {
  const { headers, rows } = figureTableData(spec);
  return (
    <table
      className={
        visuallyHidden
          ? "wiki-data-figure__table wiki-sr-only"
          : "wiki-data-figure__table"
      }
    >
      <thead>
        <tr>
          {headers.map((header) => (
            <th key={header} scope="col">
              {header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, rowIndex) => (
          <tr key={rowIndex}>
            {row.map((cell, cellIndex) => (
              <td key={cellIndex}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function WikiFigureRendered({ spec }: { spec: FigureSpec }) {
  return (
    <figure
      className="wiki-data-figure"
      data-figure-type={spec.type}
      data-figure-rendered="true"
      data-test-id="wiki-figure"
    >
      <FigureSvg spec={spec} />
      {spec.caption ? (
        <figcaption className="wiki-data-figure__caption">{spec.caption}</figcaption>
      ) : null}
      <FigureAccessibleTable spec={spec} visuallyHidden />
    </figure>
  );
}

export function WikiFigureFromSource({ source }: { source: string }) {
  const parsed = parseFigureSpec(source);
  if (!parsed.ok) {
    return (
      <figure className="wiki-data-figure wiki-data-figure--error" data-test-id="wiki-figure">
        <figcaption className="wiki-data-figure__caption">
          Figure could not be rendered: {parsed.error}
        </figcaption>
        <pre>
          <code>{source}</code>
        </pre>
      </figure>
    );
  }
  return <WikiFigureRendered spec={parsed.spec} />;
}
