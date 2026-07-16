import {
  CURSOR_MARKER,
  RESERVED_TRANSCRIPT_ROWS,
  type CursorPosition,
  type CursorWidthSemantics,
  type FixedBottomCluster,
  type FixedBottomClusterInput,
  type LineBlock,
} from "./contracts.ts";
import {
  sliceByColumns,
  stripControlSequences,
  truncateToWidth,
  visibleWidth,
} from "./line-codec.ts";

export { CURSOR_MARKER, RESERVED_TRANSCRIPT_ROWS };
export type {
  CursorPosition,
  FixedBottomCluster,
  FixedBottomClusterInput,
  LineBlock,
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(value, maximum));
}

function cropCursorLine(
  line: string,
  width: number,
  semantics: CursorWidthSemantics,
): string {
  const markerIndex = line.indexOf(semantics.cursorMarker);
  if (markerIndex === -1 || semantics.visibleWidth(line) <= width) {
    return truncateToWidth(line, width, semantics.visibleWidth);
  }

  const cursorColumn = semantics.visibleWidth(line.slice(0, markerIndex));
  const lineWidth = semantics.visibleWidth(line);
  const start = clamp(cursorColumn - Math.floor(width / 2), 0, Math.max(0, lineWidth - width));
  return sliceByColumns(line, start, width, semantics.visibleWidth);
}

function normalizeBlock(
  block: LineBlock | undefined,
  width: number,
  semantics: CursorWidthSemantics,
): string[] {
  if (!block) return [];
  return block.lines.map((line) => cropCursorLine(line, width, semantics));
}

function isMeaningful(line: string): boolean {
  return stripControlSequences(line).trim().length > 0;
}

function normalizeFooter(
  block: LineBlock | undefined,
  width: number,
  semantics: CursorWidthSemantics,
): string[] {
  const lines = normalizeBlock(block, width, semantics);
  const firstMeaningful = lines.findIndex(isMeaningful);
  if (firstMeaningful === -1) return [];

  let lastMeaningful = lines.length - 1;
  while (lastMeaningful >= firstMeaningful && !isMeaningful(lines[lastMeaningful])) {
    lastMeaningful -= 1;
  }

  const footer = lines.slice(firstMeaningful, lastMeaningful + 1);
  if (lastMeaningful < lines.length - 1) footer.push(lines.at(-1) ?? "");
  return footer;
}

function cropEditor(lines: string[], rowLimit: number, cursorMarker: string): string[] {
  if (rowLimit <= 0 || lines.length === 0) return [];
  if (lines.length <= rowLimit) return lines;

  const cursorRow = lines.findIndex((line) => line.includes(cursorMarker));
  if (cursorRow === -1) return lines.slice(0, rowLimit);

  const start = clamp(
    cursorRow - Math.floor(rowLimit / 2),
    0,
    lines.length - rowLimit,
  );
  return lines.slice(start, start + rowLimit);
}

function takeWholeBlocks(blocks: readonly string[][], capacity: number): {
  selected: string[][];
  remaining: number;
} {
  const selected: string[][] = [];
  let remaining = capacity;

  for (const block of blocks) {
    if (block.length === 0 || block.length > remaining) continue;
    selected.push(block);
    remaining -= block.length;
  }

  return { selected, remaining };
}

function extractCursor(
  lines: readonly string[],
  semantics: CursorWidthSemantics,
): FixedBottomCluster {
  let cursor: CursorPosition | null = null;
  const cleaned = lines.map((line, row) => {
    const markerIndex = line.indexOf(semantics.cursorMarker);
    if (markerIndex !== -1 && cursor === null) {
      cursor = { row, col: semantics.visibleWidth(line.slice(0, markerIndex)) };
    }
    return line.split(semantics.cursorMarker).join("");
  });

  return { lines: cleaned, cursor };
}

const defaultSemantics: CursorWidthSemantics = {
  cursorMarker: CURSOR_MARKER,
  visibleWidth,
};

export function layoutFixedBottomCluster(
  input: FixedBottomClusterInput,
  semantics: CursorWidthSemantics = defaultSemantics,
): FixedBottomCluster {
  const width = Math.max(1, Math.floor(input.width));
  const availableRows = Math.max(0, Math.floor(input.terminalRows) - RESERVED_TRANSCRIPT_ROWS);
  const normalizedEditor = normalizeBlock(input.editor, width, semantics);
  const footer = normalizeFooter(input.footer, width, semantics);
  const canReserveFooter = normalizedEditor.length > 0
    ? footer.length <= Math.max(0, availableRows - 1)
    : footer.length <= availableRows;
  const reservedFooter = canReserveFooter ? footer : [];
  const editor = cropEditor(
    normalizedEditor,
    Math.max(0, availableRows - reservedFooter.length),
    semantics.cursorMarker,
  );
  let remaining = availableRows - reservedFooter.length - editor.length;

  const status = normalizeBlock(input.status, width, semantics);
  const above = (input.aboveWidgets ?? []).map((block) => normalizeBlock(block, width, semantics));
  const below = (input.belowWidgets ?? []).map((block) => normalizeBlock(block, width, semantics));

  const footerSelection = takeWholeBlocks([reservedFooter], reservedFooter.length);
  const statusSelection = takeWholeBlocks([status], remaining);
  remaining = statusSelection.remaining;
  const aboveSelection = takeWholeBlocks(above, remaining);
  remaining = aboveSelection.remaining;
  const belowSelection = takeWholeBlocks(below, remaining);

  return extractCursor([
    ...statusSelection.selected.flat(),
    ...aboveSelection.selected.flat(),
    ...editor,
    ...belowSelection.selected.flat(),
    ...footerSelection.selected.flat(),
  ], semantics);
}
