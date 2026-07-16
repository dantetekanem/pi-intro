import type { FixedBottomCluster } from "./contracts.ts";

const KITTY_SEQUENCE_PREFIX = "\x1b_G";
const PI_SEGMENT_RESET = "\x1b[0m\x1b]8;;\x07";

export type KittyImageDelete = (imageId: number) => string;

export interface FixedBottomPaintInput {
  readonly cluster: FixedBottomCluster;
  readonly terminalRows: number;
  readonly showHardwareCursor: boolean;
}

export function deleteKittyImage(imageId: number): string {
  return `\x1b_Ga=d,d=I,i=${imageId},q=2\x1b\\`;
}

export function collectKittyImageIds(lines: readonly string[]): ReadonlySet<number> {
  const ids = new Set<number>();

  for (const line of lines) {
    let searchFrom = 0;
    while (searchFrom < line.length) {
      const sequenceStart = line.indexOf(KITTY_SEQUENCE_PREFIX, searchFrom);
      if (sequenceStart === -1) break;
      const parametersStart = sequenceStart + KITTY_SEQUENCE_PREFIX.length;
      const parametersEnd = line.indexOf(";", parametersStart);
      if (parametersEnd === -1) break;

      for (const parameter of line.slice(parametersStart, parametersEnd).split(",")) {
        const [key, value] = parameter.split("=", 2);
        const imageId = Number(value);
        if (
          key === "i"
          && Number.isInteger(imageId)
          && imageId > 0
          && imageId <= 0xffffffff
        ) {
          ids.add(imageId);
        }
      }
      searchFrom = parametersEnd + 1;
    }
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

export function paintFixedBottomCluster(input: FixedBottomPaintInput): string {
  const terminalRows = Math.max(1, Math.floor(input.terminalRows));
  const startRow = terminalRows - input.cluster.lines.length + 1;
  let output = "";

  for (let index = 0; index < input.cluster.lines.length; index += 1) {
    const row = startRow + index;
    output += `\x1b[${row};1H\x1b[2K${input.cluster.lines[index]}${PI_SEGMENT_RESET}`;
  }

  if (input.cluster.cursor) {
    const cursorRow = startRow + input.cluster.cursor.row;
    const cursorColumn = input.cluster.cursor.col + 1;
    output += `\x1b[${cursorRow};${cursorColumn}H`;
    output += input.showHardwareCursor ? "\x1b[?25h" : "\x1b[?25l";
  } else {
    output += "\x1b[?25l";
  }

  return output;
}

export function sameLines(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((line, index) => line === right[index]);
}
