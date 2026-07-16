import type { ViewportState, ViewportWindow } from "./contracts.ts";

export type { ViewportState, ViewportWindow };

function naturalNumber(value: number): number {
  return Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
}

function windowFor(offset: number, lineCount: number, visibleRows: number): ViewportWindow {
  const rows = Math.max(1, naturalNumber(visibleRows));
  const maxOffset = Math.max(0, lineCount - rows);
  const clampedOffset = Math.min(naturalNumber(offset), maxOffset);
  const start = Math.max(0, lineCount - rows - clampedOffset);

  return {
    start,
    end: Math.min(lineCount, start + rows),
    offset: clampedOffset,
    maxOffset,
  };
}

export function createViewportState(): ViewportState {
  return { offset: 0, lineCount: 0 };
}

export function updateViewport(
  state: ViewportState,
  lineCountValue: number,
  visibleRows: number,
): { state: ViewportState; window: ViewportWindow } {
  const lineCount = naturalNumber(lineCountValue);
  const appended = Math.max(0, lineCount - naturalNumber(state.lineCount));
  const anchoredOffset = state.offset > 0 ? state.offset + appended : 0;
  const window = windowFor(anchoredOffset, lineCount, visibleRows);

  return {
    state: { offset: window.offset, lineCount },
    window,
  };
}

export function scrollViewport(
  state: ViewportState,
  delta: number,
  visibleRows: number,
): { state: ViewportState; window: ViewportWindow } {
  const lineCount = naturalNumber(state.lineCount);
  const window = windowFor(state.offset + Math.trunc(delta), lineCount, visibleRows);

  return {
    state: { offset: window.offset, lineCount },
    window,
  };
}

export function followViewportBottom(
  state: ViewportState,
  visibleRows: number,
): { state: ViewportState; window: ViewportWindow } {
  const lineCount = naturalNumber(state.lineCount);
  const window = windowFor(0, lineCount, visibleRows);
  return { state: { offset: 0, lineCount }, window };
}

export function sliceViewport<T>(lines: readonly T[], window: ViewportWindow): readonly T[] {
  return lines.slice(window.start, window.end);
}
