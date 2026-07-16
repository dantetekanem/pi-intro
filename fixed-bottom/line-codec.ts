import { CURSOR_MARKER, type VisibleWidth } from "./contracts.ts";

export { CURSOR_MARKER };

interface LineUnit {
  readonly value: string;
  readonly columns: number;
  readonly control: boolean;
}

const ESC = "\x1b";
const BEL = "\x07";
const TAB_COLUMNS = 3;
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const zeroWidthCluster = /^(?:\p{Default_Ignorable_Code_Point}|\p{Control}|\p{Mark}|\p{Surrogate})+$/u;
const leadingNonPrinting = /^[\p{Default_Ignorable_Code_Point}\p{Control}\p{Format}\p{Mark}\p{Surrogate}]+/u;
const emojiPresentation = /\p{Emoji_Presentation}/u;
const regionalIndicator = /\p{Regional_Indicator}/u;
const sgrSequence = /\x1b\[[0-?]*[ -/]*m/g;

function stringControlEnd(text: string, start: number): number {
  for (let index = start; index < text.length; index += 1) {
    if (text[index] === BEL) return index + 1;
    if (text[index] === ESC && text[index + 1] === "\\") return index + 2;
  }

  return text.length;
}

function escapeEnd(text: string, start: number): number {
  const introducer = text[start + 1];
  if (introducer === undefined) return start + 1;

  if (introducer === "[") {
    for (let index = start + 2; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      if (code >= 0x40 && code <= 0x7e) return index + 1;
    }
    return text.length;
  }

  if (introducer === "]" || introducer === "_" || introducer === "P" || introducer === "^" || introducer === "X") {
    return stringControlEnd(text, start + 2);
  }

  return Math.min(text.length, start + 2);
}

function isFullWidth(codePoint: number): boolean {
  return codePoint >= 0x1100 && (
    codePoint <= 0x115f
    || codePoint === 0x2329
    || codePoint === 0x232a
    || (codePoint >= 0x2e80 && codePoint <= 0x303e)
    || (codePoint >= 0x3040 && codePoint <= 0xa4cf)
    || (codePoint >= 0xac00 && codePoint <= 0xd7a3)
    || (codePoint >= 0xf900 && codePoint <= 0xfaff)
    || (codePoint >= 0xfe10 && codePoint <= 0xfe19)
    || (codePoint >= 0xfe30 && codePoint <= 0xfe6f)
    || (codePoint >= 0xff00 && codePoint <= 0xff60)
    || (codePoint >= 0xffe0 && codePoint <= 0xffe6)
    || (codePoint >= 0x1b000 && codePoint <= 0x1b2ff)
    || (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  );
}

function graphemeColumns(grapheme: string): number {
  if (grapheme === "\t") return TAB_COLUMNS;
  if (zeroWidthCluster.test(grapheme)) return 0;
  if (
    emojiPresentation.test(grapheme)
    || grapheme.includes("\ufe0f")
    || grapheme.includes("\u200d")
    || regionalIndicator.test(grapheme)
  ) return 2;

  const printable = grapheme.replace(leadingNonPrinting, "");
  const codePoint = printable.codePointAt(0);
  if (codePoint === undefined) return 0;

  let columns = isFullWidth(codePoint) ? 2 : 1;
  for (const character of printable.slice(String.fromCodePoint(codePoint).length)) {
    const trailingCodePoint = character.codePointAt(0);
    if (trailingCodePoint === undefined) continue;
    if (trailingCodePoint === 0x0e33 || trailingCodePoint === 0x0eb3) columns += 1;
    else if (trailingCodePoint >= 0xff00 && trailingCodePoint <= 0xffef) {
      columns += isFullWidth(trailingCodePoint) ? 2 : 1;
    }
  }
  return columns;
}

function lineUnits(line: string): LineUnit[] {
  const units: LineUnit[] = [];
  let index = 0;

  while (index < line.length) {
    if (line[index] === ESC) {
      const end = escapeEnd(line, index);
      units.push({ value: line.slice(index, end), columns: 0, control: true });
      index = end;
      continue;
    }

    if (line[index] === "\t") {
      units.push({ value: "\t", columns: TAB_COLUMNS, control: false });
      index += 1;
      continue;
    }

    const codePoint = line.codePointAt(index);
    if (codePoint !== undefined && (codePoint < 0x20 || (codePoint >= 0x7f && codePoint <= 0x9f))) {
      const value = String.fromCodePoint(codePoint);
      units.push({ value, columns: 0, control: true });
      index += value.length;
      continue;
    }

    let end = index;
    while (end < line.length && line[end] !== ESC && line[end] !== "\t") {
      const next = line.codePointAt(end);
      if (next !== undefined && (next < 0x20 || (next >= 0x7f && next <= 0x9f))) break;
      end += next !== undefined && next > 0xffff ? 2 : 1;
    }

    for (const { segment } of segmenter.segment(line.slice(index, end))) {
      units.push({ value: segment, columns: graphemeColumns(segment), control: false });
    }
    index = end;
  }

  return units;
}

export function stripControlSequences(line: string): string {
  return lineUnits(line)
    .filter((unit) => !unit.control)
    .map((unit) => unit.value)
    .join("");
}

export function visibleWidth(line: string): number {
  return lineUnits(line).reduce((columns, unit) => columns + unit.columns, 0);
}

export function sliceByColumns(
  line: string,
  startColumn: number,
  columnCount: number,
  measureWidth: VisibleWidth = visibleWidth,
): string {
  const start = Math.max(0, Math.floor(startColumn));
  const length = Math.max(0, Math.floor(columnCount));
  if (length === 0) return "";

  const end = start + length;
  let column = 0;
  let output = "";

  for (const unit of lineUnits(line)) {
    if (unit.control) {
      if (column >= start && column <= end) output += unit.value;
      continue;
    }

    const columns = measureWidth === visibleWidth ? unit.columns : measureWidth(unit.value);
    const unitEnd = column + columns;
    if (columns === 0) {
      if (column >= start && column < end) output += unit.value;
    } else if (column >= start && unitEnd <= end) {
      output += unit.value;
    }
    column = unitEnd;
  }

  return output;
}

function leavesSgrActive(line: string): boolean {
  let active = false;
  for (const sequence of line.match(sgrSequence) ?? []) {
    const parameters = sequence.slice(2, -1);
    active = parameters !== "" && !parameters.split(";").includes("0");
  }
  return active;
}

export function truncateToWidth(
  line: string,
  maxColumns: number,
  measureWidth: VisibleWidth = visibleWidth,
): string {
  const width = Math.max(0, Math.floor(maxColumns));
  if (measureWidth(line) <= width) return line;

  const truncated = sliceByColumns(line, 0, width, measureWidth);
  return leavesSgrActive(truncated) ? `${truncated}\x1b[0m` : truncated;
}
