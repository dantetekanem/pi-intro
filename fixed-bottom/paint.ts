import type { FixedBottomCluster } from "./contracts.ts";

const KITTY_SEQUENCE_PREFIX = "\x1b_G";
const PI_SEGMENT_RESET = "\x1b[0m\x1b]8;;\x07";

export type KittyImageDelete = (imageId: number) => string;

export interface FixedBottomPaintInput {
  readonly cluster: FixedBottomCluster;
  readonly terminalRows: number;
  readonly previousLines?: readonly string[];
  readonly previousTerminalRows?: number;
  readonly force?: boolean;
  readonly deleteImage?: KittyImageDelete;
}

export interface FixedBottomPaintPlan {
  readonly deleteSequence: string;
  readonly paintSequence: string;
}

interface KittyLineInfo {
  readonly imageIds: ReadonlySet<number>;
  readonly reservedRows: number;
}

interface KittyPlacement {
  readonly row: number;
  readonly reservedRows: number;
  readonly line: string;
  readonly blockLines: readonly string[];
  readonly imageIds: ReadonlySet<number>;
}

interface PhysicalFrame {
  readonly lines: ReadonlyMap<number, string>;
  readonly imageStarts: ReadonlyMap<number, KittyPlacement>;
  readonly imageRows: ReadonlySet<number>;
  readonly placementsById: ReadonlyMap<number, KittyPlacement>;
}

export function deleteKittyImage(imageId: number): string {
  return `\x1b_Ga=d,d=I,i=${imageId},q=2\x1b\\`;
}

function kittyLineInfo(line: string): KittyLineInfo | null {
  const imageIds = new Set<number>();
  let reservedRows = 1;
  let foundSequence = false;
  let searchFrom = 0;

  while (searchFrom < line.length) {
    const sequenceStart = line.indexOf(KITTY_SEQUENCE_PREFIX, searchFrom);
    if (sequenceStart === -1) break;
    const parametersStart = sequenceStart + KITTY_SEQUENCE_PREFIX.length;
    const parametersEnd = line.indexOf(";", parametersStart);
    if (parametersEnd === -1) break;
    foundSequence = true;

    for (const parameter of line.slice(parametersStart, parametersEnd).split(",")) {
      const [key, value] = parameter.split("=", 2);
      const numericValue = Number(value);
      if (
        key === "i"
        && Number.isInteger(numericValue)
        && numericValue > 0
        && numericValue <= 0xffffffff
      ) {
        imageIds.add(numericValue);
      }
      if (key === "r" && Number.isInteger(numericValue) && numericValue > 0) {
        reservedRows = Math.max(reservedRows, numericValue);
      }
    }
    searchFrom = parametersEnd + 1;
  }

  return foundSequence ? { imageIds, reservedRows } : null;
}

export function collectKittyImageIds(lines: readonly string[]): ReadonlySet<number> {
  const ids = new Set<number>();
  for (const line of lines) {
    const info = kittyLineInfo(line);
    if (!info) continue;
    for (const imageId of info.imageIds) ids.add(imageId);
  }
  return ids;
}

export function deleteKittyImages(
  imageIds: Iterable<number>,
  deleteImage: KittyImageDelete = deleteKittyImage,
): string {
  let output = "";
  for (const imageId of imageIds) output += deleteImage(imageId);
  return output;
}

export function clearFixedBottomRows(rowCount: number, terminalRows: number): string {
  const rows = Math.max(0, Math.min(Math.floor(rowCount), Math.floor(terminalRows)));
  const bottom = Math.max(1, Math.floor(terminalRows));
  const start = bottom - rows + 1;
  let output = "";
  for (let row = start; row <= bottom; row += 1) {
    output += `\x1b[${row};1H\x1b[2K`;
  }
  return output;
}

function physicalFrame(
  lines: readonly string[],
  terminalRows: number,
): PhysicalFrame {
  const bottom = Math.max(1, Math.floor(terminalRows));
  const startRow = bottom - lines.length + 1;
  const physicalLines = new Map<number, string>();
  const imageStarts = new Map<number, KittyPlacement>();
  const imageRows = new Set<number>();
  const placementsById = new Map<number, KittyPlacement>();

  for (let index = 0; index < lines.length; index += 1) {
    physicalLines.set(startRow + index, lines[index]);
  }

  for (let index = 0; index < lines.length; index += 1) {
    const info = kittyLineInfo(lines[index]);
    if (!info) continue;
    const row = startRow + index;
    const reservedRows = Math.max(1, Math.min(
      info.reservedRows,
      lines.length - index,
      bottom - row + 1,
    ));
    const placement: KittyPlacement = {
      row,
      reservedRows,
      line: lines[index],
      blockLines: lines.slice(index, index + reservedRows),
      imageIds: info.imageIds,
    };
    imageStarts.set(row, placement);
    for (let offset = 0; offset < reservedRows; offset += 1) {
      imageRows.add(row + offset);
    }
    for (const imageId of info.imageIds) placementsById.set(imageId, placement);
  }

  return { lines: physicalLines, imageStarts, imageRows, placementsById };
}

function samePlacement(left: KittyPlacement, right: KittyPlacement): boolean {
  return left.row === right.row
    && left.reservedRows === right.reservedRows
    && left.blockLines.length === right.blockLines.length
    && left.blockLines.every((line, index) => line === right.blockLines[index]);
}

function placementRows(placement: KittyPlacement): number[] {
  return Array.from({ length: placement.reservedRows }, (_, index) => placement.row + index);
}

export function planFixedBottomClusterPaint(input: FixedBottomPaintInput): FixedBottomPaintPlan {
  const terminalRows = Math.max(1, Math.floor(input.terminalRows));
  const previousTerminalRows = Math.max(
    1,
    Math.floor(input.previousTerminalRows ?? terminalRows),
  );
  const previous = physicalFrame(input.previousLines ?? [], previousTerminalRows);
  const current = physicalFrame(input.cluster.lines, terminalRows);
  const invalidatedImageIds = new Set<number>();
  const clearRows = new Set<number>();
  const repaintImageRows = new Set<number>();

  for (const [imageId, oldPlacement] of previous.placementsById) {
    const newPlacement = current.placementsById.get(imageId);
    if (!newPlacement || !samePlacement(oldPlacement, newPlacement)) {
      invalidatedImageIds.add(imageId);
      for (const row of placementRows(oldPlacement)) clearRows.add(row);
    }
  }

  for (const placement of current.imageStarts.values()) {
    const stable = !input.force
      && placement.imageIds.size > 0
      && [...placement.imageIds].every((imageId) => {
        const oldPlacement = previous.placementsById.get(imageId);
        return oldPlacement !== undefined && samePlacement(oldPlacement, placement);
      });
    if (stable) continue;
    repaintImageRows.add(placement.row);
    for (const row of placementRows(placement)) clearRows.add(row);
  }

  for (const oldPlacement of previous.imageStarts.values()) {
    if (oldPlacement.imageIds.size > 0) continue;
    const replacement = current.imageStarts.get(oldPlacement.row);
    if (!replacement || !samePlacement(oldPlacement, replacement)) {
      for (const row of placementRows(oldPlacement)) clearRows.add(row);
    }
  }

  let paintSequence = "";
  for (const row of [...clearRows].sort((left, right) => left - right)) {
    paintSequence += `\x1b[${row};1H\x1b[2K`;
  }

  const rows = new Set([...previous.lines.keys(), ...current.lines.keys()]);
  for (const row of [...rows].sort((left, right) => left - right)) {
    const imagePlacement = current.imageStarts.get(row);
    if (imagePlacement) {
      if (repaintImageRows.has(row)) {
        paintSequence += `\x1b[${row};1H${imagePlacement.line}`;
      }
      continue;
    }
    if (current.imageRows.has(row)) continue;

    const previousLine = previous.lines.get(row);
    const currentLine = current.lines.get(row);
    if (
      !input.force
      && currentLine === previousLine
      && !(clearRows.has(row) && currentLine !== undefined && currentLine !== "")
    ) {
      continue;
    }
    if (currentLine !== undefined) {
      paintSequence += `\x1b[${row};1H${currentLine}${PI_SEGMENT_RESET}\x1b[0K`;
    } else if (previousLine !== undefined && !clearRows.has(row)) {
      paintSequence += `\x1b[${row};1H\x1b[2K`;
    }
  }

  return {
    deleteSequence: deleteKittyImages(invalidatedImageIds, input.deleteImage),
    paintSequence,
  };
}

export function paintFixedBottomCluster(input: FixedBottomPaintInput): string {
  const plan = planFixedBottomClusterPaint(input);
  return plan.deleteSequence + plan.paintSequence;
}

export function sameLines(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((line, index) => line === right[index]);
}
