const WIDTH_ROUNDING = 4;
const DEFAULT_LINE_HEIGHT_RATIO = 1.45;
const CANDIDATE_STEPS = [0, 0.38, 0.72, 1];

type ColumnKind = "numeric" | "compact" | "text";

interface TextMetrics {
  font: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: string;
  letterSpacing: number;
  lineHeight: number;
  paddingX: number;
  paddingY: number;
  textTransform: string;
}

interface ColumnModel {
  cells: HTMLTableCellElement[];
  kind: ColumnKind;
  minWidth: number;
  preferredWidth: number;
  flexWeight: number;
  pressureWeight: number;
  candidateWidths: number[];
}

interface TableMatrix {
  rows: Array<Array<HTMLTableCellElement | null>>;
  columns: HTMLTableCellElement[][];
  columnCount: number;
}

interface TablePlan {
  widths: number[];
  totalWidth: number;
}

interface SmartTableOptions {
  persistenceKey?: string;
}

const canvas =
  typeof document === "undefined" ? null : document.createElement("canvas");
const canvasContext = canvas?.getContext("2d") ?? null;
let measurementHost: HTMLDivElement | null = null;
let measurementNode: HTMLDivElement | null = null;
const textWidthCache = new Map<string, number>();
const textHeightCache = new Map<string, number>();
const manualWidthMemory = new Map<string, number[]>();
const MANUAL_WIDTHS_PREFIX = "smart-table-widths:";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function roundWidth(value: number) {
  return Math.max(WIDTH_ROUNDING, Math.round(value / WIDTH_ROUNDING) * WIDTH_ROUNDING);
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function applyTextTransform(value: string, textTransform: string) {
  switch (textTransform) {
    case "uppercase":
      return value.toUpperCase();
    case "lowercase":
      return value.toLowerCase();
    case "capitalize":
      return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
    default:
      return value;
  }
}

function percentile(values: number[], ratio: number) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.round((sorted.length - 1) * ratio))
  );
  return sorted[index] ?? sorted[sorted.length - 1] ?? 0;
}

function getMeasurementNode() {
  if (!measurementHost || !measurementNode) {
    measurementHost = document.createElement("div");
    measurementHost.style.position = "absolute";
    measurementHost.style.left = "-100000px";
    measurementHost.style.top = "0";
    measurementHost.style.visibility = "hidden";
    measurementHost.style.pointerEvents = "none";
    measurementHost.style.contain = "layout style size";

    measurementNode = document.createElement("div");
    measurementHost.appendChild(measurementNode);
    document.body.appendChild(measurementHost);
  }

  return measurementNode;
}

function readTextMetrics(cell: HTMLTableCellElement): TextMetrics {
  const style = window.getComputedStyle(cell);
  const fontSize = Number.parseFloat(style.fontSize) || 15;
  const rawLineHeight = Number.parseFloat(style.lineHeight);

  return {
    font: [
      style.fontStyle,
      style.fontVariant,
      style.fontWeight,
      style.fontSize,
      style.fontFamily,
    ]
      .filter(Boolean)
      .join(" "),
    fontFamily: style.fontFamily,
    fontSize,
    fontWeight: style.fontWeight,
    letterSpacing:
      style.letterSpacing === "normal"
        ? 0
        : Number.parseFloat(style.letterSpacing) || 0,
    lineHeight:
      Number.isFinite(rawLineHeight) && rawLineHeight > 0
        ? rawLineHeight
        : fontSize * DEFAULT_LINE_HEIGHT_RATIO,
    paddingX:
      (Number.parseFloat(style.paddingLeft) || 0) +
      (Number.parseFloat(style.paddingRight) || 0),
    paddingY:
      (Number.parseFloat(style.paddingTop) || 0) +
      (Number.parseFloat(style.paddingBottom) || 0),
    textTransform: style.textTransform,
  };
}

function measureTextWidth(text: string, metrics: TextMetrics) {
  const renderedText = applyTextTransform(text || " ", metrics.textTransform);
  const cacheKey = [
    "w",
    metrics.font,
    metrics.letterSpacing,
    metrics.paddingX,
    renderedText,
  ].join("|");
  const cached = textWidthCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  if (!canvasContext) {
    const fallback = renderedText.length * metrics.fontSize * 0.62 + metrics.paddingX;
    textWidthCache.set(cacheKey, fallback);
    return fallback;
  }

  canvasContext.font = metrics.font;
  const measured =
    canvasContext.measureText(renderedText).width +
    Math.max(0, renderedText.length - 1) * metrics.letterSpacing +
    metrics.paddingX;

  textWidthCache.set(cacheKey, measured);
  return measured;
}

function measureLongestToken(text: string, metrics: TextMetrics) {
  const tokens = normalizeText(text)
    .split(/[\s/]+/)
    .filter(Boolean);

  if (tokens.length === 0) {
    return measureTextWidth(" ", metrics);
  }

  let widest = 0;
  for (const token of tokens) {
    widest = Math.max(widest, measureTextWidth(token, metrics));
  }

  return widest;
}

function measureTextHeight(text: string, metrics: TextMetrics, width: number) {
  const renderedText = applyTextTransform(text || " ", metrics.textTransform);
  const cacheKey = [
    "h",
    metrics.font,
    metrics.letterSpacing,
    metrics.lineHeight,
    metrics.paddingX,
    metrics.paddingY,
    roundWidth(width),
    renderedText,
  ].join("|");
  const cached = textHeightCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const node = getMeasurementNode();
  node.style.boxSizing = "border-box";
  node.style.width = `${Math.max(roundWidth(width), WIDTH_ROUNDING)}px`;
  node.style.padding = `${metrics.paddingY / 2}px ${metrics.paddingX / 2}px`;
  node.style.fontFamily = metrics.fontFamily;
  node.style.fontSize = `${metrics.fontSize}px`;
  node.style.fontWeight = metrics.fontWeight;
  node.style.lineHeight = `${metrics.lineHeight}px`;
  node.style.letterSpacing = `${metrics.letterSpacing}px`;
  node.style.whiteSpace = "normal";
  node.style.overflowWrap = "anywhere";
  node.style.wordBreak = "break-word";
  node.textContent = renderedText;

  const measured = Math.ceil(node.getBoundingClientRect().height);
  textHeightCache.set(cacheKey, measured);
  return measured;
}

function classifyColumn(texts: string[]) {
  const nonEmpty = texts.filter(Boolean);
  if (nonEmpty.length === 0) {
    return "compact" as const;
  }

  const numericLike = nonEmpty.filter((text) =>
    /^[\d\s,.%$€£()+\-/:]+$/.test(text)
  ).length;
  const averageLength =
    nonEmpty.reduce((sum, text) => sum + text.length, 0) / nonEmpty.length;

  if (numericLike / nonEmpty.length >= 0.7) {
    return "numeric" as const;
  }

  if (averageLength <= 16) {
    return "compact" as const;
  }

  return "text" as const;
}

function collectTableMatrix(table: HTMLTableElement): TableMatrix | null {
  const rowElements = Array.from(table.querySelectorAll("tr"));
  if (rowElements.length === 0) {
    return null;
  }

  const rawRows: HTMLTableCellElement[][] = [];
  let columnCount = 0;

  for (const row of rowElements) {
    const cells = Array.from(row.cells);
    if (cells.length === 0) {
      continue;
    }
    if (cells.some((cell) => cell.colSpan !== 1 || cell.rowSpan !== 1)) {
      return null;
    }
    rawRows.push(cells);
    columnCount = Math.max(columnCount, cells.length);
  }

  if (rawRows.length === 0 || columnCount === 0) {
    return null;
  }

  const rows = rawRows.map((row) =>
    Array.from({ length: columnCount }, (_, index) => row[index] ?? null)
  );
  const columns = Array.from({ length: columnCount }, (_, columnIndex) =>
    rows
      .map((row) => row[columnIndex])
      .filter((cell): cell is HTMLTableCellElement => cell !== null)
  );

  return { rows, columns, columnCount };
}

function buildColumnModel(cells: HTMLTableCellElement[]): ColumnModel {
  const texts = cells.map((cell) => normalizeText(cell.textContent ?? ""));
  const kind = classifyColumn(texts);

  const bounds =
    kind === "numeric"
      ? { min: 72, max: 160 }
      : kind === "compact"
        ? { min: 96, max: 240 }
        : { min: 144, max: 420 };

  const nowrapWidths: number[] = [];
  const tokenWidths: number[] = [];

  for (const cell of cells) {
    const metrics = readTextMetrics(cell);
    const text = normalizeText(cell.textContent ?? "");
    nowrapWidths.push(measureTextWidth(text || " ", metrics));
    tokenWidths.push(
      Math.min(
        measureLongestToken(text || " ", metrics),
        kind === "text" ? 220 : bounds.max
      )
    );
  }

  const averageLength =
    texts.reduce((sum, text) => sum + text.length, 0) / Math.max(texts.length, 1);
  const tokenTarget = percentile(tokenWidths, 0.9);
  const lineTarget = percentile(nowrapWidths, kind === "text" ? 0.74 : 0.82);
  const compressedTarget =
    kind === "text"
      ? lineTarget * 0.72
      : kind === "compact"
        ? lineTarget * 0.88
        : lineTarget;

  const preferredWidth = roundWidth(
    clamp(
      Math.max(tokenTarget + 10, compressedTarget, bounds.min),
      bounds.min,
      bounds.max
    )
  );
  const minWidth = roundWidth(
    clamp(
      Math.max(bounds.min, Math.min(tokenTarget + 4, preferredWidth - 20)),
      bounds.min,
      preferredWidth
    )
  );

  const candidateWidths = Array.from(
    new Set(
      CANDIDATE_STEPS.map((step) =>
        roundWidth(minWidth + (preferredWidth - minWidth) * step)
      )
    )
  ).sort((left, right) => left - right);

  if (candidateWidths[candidateWidths.length - 1] !== preferredWidth) {
    candidateWidths.push(preferredWidth);
  }

  return {
    cells,
    kind,
    minWidth,
    preferredWidth,
    flexWeight:
      kind === "text"
        ? 1.4 + averageLength / 40
        : kind === "compact"
          ? 0.9 + averageLength / 64
          : 0.45,
    pressureWeight:
      kind === "text" ? 0.085 : kind === "compact" ? 0.05 : 0.02,
    candidateWidths,
  };
}

function computeCost(
  matrix: TableMatrix,
  columnModels: ColumnModel[],
  heightMatrix: number[][][],
  columnIndexes: number[]
) {
  let totalHeight = 0;

  for (let rowIndex = 0; rowIndex < matrix.rows.length; rowIndex += 1) {
    let rowHeight = 0;
    for (let columnIndex = 0; columnIndex < matrix.columnCount; columnIndex += 1) {
      const cell = matrix.rows[rowIndex]?.[columnIndex];
      if (!cell) {
        continue;
      }

      rowHeight = Math.max(
        rowHeight,
        heightMatrix[rowIndex]?.[columnIndex]?.[columnIndexes[columnIndex] ?? 0] ?? 0
      );
    }
    totalHeight += rowHeight;
  }

  const widths = columnModels.map(
    (model, columnIndex) =>
      model.candidateWidths[columnIndexes[columnIndex] ?? 0] ?? model.minWidth
  );
  const totalWidth = widths.reduce((sum, width) => sum + width, 0);
  const averageWidth = totalWidth / Math.max(widths.length, 1);
  const variance =
    widths.reduce((sum, width) => sum + (width - averageWidth) ** 2, 0) /
    Math.max(widths.length, 1);
  const widthPressure = widths.reduce((sum, width, columnIndex) => {
    const preferred = columnModels[columnIndex]?.preferredWidth ?? width;
    const pressureWeight = columnModels[columnIndex]?.pressureWeight ?? 0;
    return sum + Math.max(0, preferred - width) * pressureWeight;
  }, 0);

  return totalHeight + widthPressure + Math.sqrt(variance) * 0.35;
}

function distributeLeftoverWidth(
  widths: number[],
  columnModels: ColumnModel[],
  availableWidth: number
) {
  const usedWidth = widths.reduce((sum, width) => sum + width, 0);
  let remaining = Math.max(0, availableWidth - usedWidth);
  if (remaining <= 0) {
    return widths;
  }

  const eligible = columnModels
    .map((model, index) => {
      const currentWidth = widths[index] ?? model.minWidth;
      const preferredShortfall = Math.max(0, model.preferredWidth - currentWidth);
      const weight =
        model.kind === "text"
          ? model.flexWeight + preferredShortfall / 80
          : preferredShortfall > 0
            ? model.flexWeight
            : 0;
      return { index, weight };
    })
    .filter((entry) => entry.weight > 0);

  if (eligible.length === 0) {
    widths[widths.length - 1] = (widths[widths.length - 1] ?? 0) + remaining;
    return widths;
  }

  const totalWeight = eligible.reduce((sum, entry) => sum + entry.weight, 0);
  eligible.forEach((entry, eligibleIndex) => {
    const share =
      eligibleIndex === eligible.length - 1
        ? remaining
        : Math.min(remaining, roundWidth((remaining * entry.weight) / totalWeight));
    widths[entry.index] = (widths[entry.index] ?? 0) + share;
    remaining -= share;
  });

  if (remaining > 0) {
    const last = eligible[eligible.length - 1];
    widths[last.index] = (widths[last.index] ?? 0) + remaining;
  }

  return widths;
}

function computeTablePlan(table: HTMLTableElement, availableWidth: number): TablePlan | null {
  const matrix = collectTableMatrix(table);
  if (!matrix) {
    return null;
  }

  const columnModels = matrix.columns.map((cells) => buildColumnModel(cells));
  if (columnModels.length === 0) {
    return null;
  }

  const minTotal = columnModels.reduce((sum, model) => sum + model.minWidth, 0);

  if (availableWidth <= 0 || minTotal >= availableWidth) {
    return {
      widths: columnModels.map((model) => model.minWidth),
      totalWidth: minTotal,
    };
  }

  const heightMatrix = matrix.rows.map((row) =>
    row.map((cell, columnIndex) => {
      if (!cell) {
        return [0];
      }

      const metrics = readTextMetrics(cell);
      const text = normalizeText(cell.textContent ?? "");
      return columnModels[columnIndex]!.candidateWidths.map((width) =>
        measureTextHeight(text || " ", metrics, width)
      );
    })
  );

  const indexes = columnModels.map(() => 0);
  let remainingWidth = availableWidth - minTotal;
  let currentCost = computeCost(matrix, columnModels, heightMatrix, indexes);

  while (remainingWidth >= WIDTH_ROUNDING) {
    let bestColumn = -1;
    let bestScore = 0;
    let bestImprovement = 0;
    let bestDelta = 0;

    for (let columnIndex = 0; columnIndex < columnModels.length; columnIndex += 1) {
      const model = columnModels[columnIndex]!;
      const currentIndex = indexes[columnIndex] ?? 0;
      const nextWidth = model.candidateWidths[currentIndex + 1];
      if (nextWidth === undefined) {
        continue;
      }

      const currentWidth = model.candidateWidths[currentIndex] ?? model.minWidth;
      const delta = nextWidth - currentWidth;
      if (delta > remainingWidth + 0.5) {
        continue;
      }

      indexes[columnIndex] = currentIndex + 1;
      const nextCost = computeCost(matrix, columnModels, heightMatrix, indexes);
      indexes[columnIndex] = currentIndex;

      const improvement = currentCost - nextCost;
      const score = improvement / Math.max(delta, 1);

      if (
        score > bestScore + 0.001 ||
        (Math.abs(score - bestScore) < 0.001 && improvement > bestImprovement)
      ) {
        bestColumn = columnIndex;
        bestScore = score;
        bestImprovement = improvement;
        bestDelta = delta;
      }
    }

    if (bestColumn === -1 || bestImprovement <= 0.05) {
      break;
    }

    indexes[bestColumn] = (indexes[bestColumn] ?? 0) + 1;
    remainingWidth -= bestDelta;
    currentCost -= bestImprovement;
  }

  const widths = columnModels.map(
    (model, columnIndex) =>
      model.candidateWidths[indexes[columnIndex] ?? 0] ?? model.minWidth
  );
  distributeLeftoverWidth(widths, columnModels, availableWidth);

  return {
    widths,
    totalWidth: widths.reduce((sum, width) => sum + width, 0),
  };
}

function ensureColgroup(table: HTMLTableElement, columnCount: number) {
  let colgroup = table.querySelector(":scope > colgroup");
  if (!colgroup) {
    colgroup = document.createElement("colgroup");
    const caption = table.querySelector(":scope > caption");
    table.insertBefore(colgroup, caption?.nextSibling ?? table.firstChild);
  }

  while (colgroup.children.length < columnCount) {
    colgroup.appendChild(document.createElement("col"));
  }
  while (colgroup.children.length > columnCount) {
    colgroup.lastElementChild?.remove();
  }

  return Array.from(colgroup.children) as HTMLTableColElement[];
}

function readCurrentWidths(table: HTMLTableElement, columnCount: number) {
  const headerCells = Array.from(
    table.querySelectorAll<HTMLTableCellElement>("thead th")
  );
  if (headerCells.length >= columnCount) {
    return headerCells.slice(0, columnCount).map((cell) => cell.getBoundingClientRect().width);
  }

  const row = table.querySelector("tr");
  if (!row) {
    return Array.from({ length: columnCount }, () => 0);
  }

  return Array.from(row.cells)
    .slice(0, columnCount)
    .map((cell) => cell.getBoundingClientRect().width);
}

function syncWidthsFromColumns(table: HTMLTableElement, widths: number[]) {
  const cols = ensureColgroup(table, widths.length);
  widths.forEach((width, columnIndex) => {
    const col = cols[columnIndex];
    if (!col) {
      return;
    }
    col.style.width = `${roundWidth(width)}px`;
  });

  table.style.tableLayout = "fixed";
  table.style.width = `${roundWidth(widths.reduce((sum, width) => sum + width, 0))}px`;
  table.dataset.smartTable = "enhanced";
}

function syncWidthFromColgroup(table: HTMLTableElement) {
  const widths = Array.from(table.querySelectorAll<HTMLTableColElement>("colgroup col"))
    .map((col) => Number.parseFloat(col.style.width))
    .filter((width) => Number.isFinite(width) && width > 0);

  if (widths.length === 0) {
    return;
  }

  table.style.tableLayout = "fixed";
  table.style.width = `${roundWidth(widths.reduce((sum, width) => sum + width, 0))}px`;
}

function getStoredManualWidths(key?: string) {
  if (!key) {
    return null;
  }

  const memory = manualWidthMemory.get(key);
  if (memory && memory.length > 0) {
    return memory;
  }

  try {
    const raw = window.sessionStorage.getItem(`${MANUAL_WIDTHS_PREFIX}${key}`);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return null;
    }
    const widths = parsed
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value > 0)
      .map((value) => roundWidth(value));
    if (widths.length === 0) {
      return null;
    }
    manualWidthMemory.set(key, widths);
    return widths;
  } catch {
    return null;
  }
}

function persistManualWidths(key: string | undefined, widths: number[]) {
  if (!key || widths.length === 0) {
    return;
  }

  const rounded = widths.map((width) => roundWidth(width));
  manualWidthMemory.set(key, rounded);

  try {
    window.sessionStorage.setItem(
      `${MANUAL_WIDTHS_PREFIX}${key}`,
      JSON.stringify(rounded)
    );
  } catch {
    // Ignore storage failures; in-memory persistence still helps within the page.
  }
}

function restoreManualWidths(table: HTMLTableElement, widths: number[]) {
  const cols = ensureColgroup(table, widths.length);
  widths.forEach((width, index) => {
    const col = cols[index];
    if (col) {
      col.style.width = `${roundWidth(width)}px`;
    }
  });
  table.dataset.smartTableLocked = "manual";
  syncWidthFromColgroup(table);
}

export function installSmartTableLayout(
  table: HTMLTableElement,
  wrapper: HTMLElement,
  options: SmartTableOptions = {}
) {
  let frame = 0;
  let cancelled = false;

  const restorePersistedState = () => {
    if (table.dataset.smartTableLocked === "manual") {
      syncWidthFromColgroup(table);
      return true;
    }

    const columnCount = table.querySelectorAll("thead th").length;
    const persistedWidths = getStoredManualWidths(options.persistenceKey);
    if (
      persistedWidths &&
      persistedWidths.length > 0 &&
      (columnCount === 0 || persistedWidths.length === columnCount)
    ) {
      restoreManualWidths(table, persistedWidths);
      return true;
    }

    return false;
  };

  const schedule = () => {
    if (cancelled) {
      return;
    }

    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      if (cancelled || !table.isConnected || !wrapper.isConnected) {
        return;
      }

      if (restorePersistedState()) {
        return;
      }

      const wrapperStyle = window.getComputedStyle(wrapper);
      const paddingLeft = Number.parseFloat(wrapperStyle.paddingLeft) || 0;
      const paddingRight = Number.parseFloat(wrapperStyle.paddingRight) || 0;
      const availableWidth = Math.floor(
        wrapper.clientWidth - paddingLeft - paddingRight
      );
      const plan = computeTablePlan(table, availableWidth);
      if (!plan) {
        return;
      }

      const nextKey = plan.widths.map((width) => roundWidth(width)).join(",");
      if (table.dataset.smartTableWidths === nextKey) {
        return;
      }

      table.dataset.smartTableWidths = nextKey;
      syncWidthsFromColumns(table, plan.widths);
    });
  };

  schedule();

  const resizeObserver = new ResizeObserver(schedule);
  resizeObserver.observe(wrapper);

  void document.fonts?.ready.then(schedule);

  return () => {
    cancelled = true;
    cancelAnimationFrame(frame);
    resizeObserver.disconnect();
  };
}

export function attachSmartResizeHandles(
  table: HTMLTableElement,
  options: SmartTableOptions = {}
) {
  const headerCells = Array.from(
    table.querySelectorAll<HTMLTableCellElement>("thead th")
  );
  if (headerCells.length === 0) {
    return () => {};
  }

  const cleanups: Array<() => void> = [];

  headerCells.forEach((cell, columnIndex) => {
    cell.classList.add("relative", "group/resize");

    const handle = document.createElement("div");
    handle.className =
      "smart-table-resize-handle absolute right-0 top-0 bottom-0 w-2 cursor-col-resize opacity-0 group-hover/resize:opacity-100 hover:!opacity-100 bg-[var(--brand)]/70 transition-opacity";
    handle.setAttribute("role", "separator");
    handle.setAttribute("aria-orientation", "vertical");
    handle.setAttribute("aria-label", `Resize column ${columnIndex + 1}`);
    cell.appendChild(handle);

    const onMouseDown = (event: MouseEvent) => {
      event.preventDefault();

      const widths = readCurrentWidths(table, headerCells.length);
      const cols = ensureColgroup(table, headerCells.length);
      widths.forEach((width, widthIndex) => {
        const col = cols[widthIndex];
        if (col) {
          col.style.width = `${roundWidth(width)}px`;
        }
      });

      table.dataset.smartTableLocked = "manual";
      table.style.tableLayout = "fixed";
      table.style.width = `${roundWidth(widths.reduce((sum, width) => sum + width, 0))}px`;
      persistManualWidths(options.persistenceKey, widths);

      const startX = event.clientX;
      const startWidth = widths[columnIndex] ?? cell.getBoundingClientRect().width;
      const startTableWidth = widths.reduce((sum, width) => sum + width, 0);

      const onMouseMove = (moveEvent: MouseEvent) => {
        const nextWidth = Math.max(56, roundWidth(startWidth + moveEvent.clientX - startX));
        const delta = nextWidth - startWidth;

        const col = cols[columnIndex];
        if (col) {
          col.style.width = `${nextWidth}px`;
        }
        const nextTableWidth = roundWidth(startTableWidth + delta);
        table.style.width = `${nextTableWidth}px`;
        const nextWidths = cols.map((col) => Number.parseFloat(col.style.width)).filter(
          (width) => Number.isFinite(width) && width > 0
        );
        persistManualWidths(options.persistenceKey, nextWidths);
      };

      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    };

    handle.addEventListener("mousedown", onMouseDown);
    cleanups.push(() => {
      handle.removeEventListener("mousedown", onMouseDown);
      handle.remove();
    });
  });

  return () => {
    cleanups.forEach((cleanup) => cleanup());
  };
}
