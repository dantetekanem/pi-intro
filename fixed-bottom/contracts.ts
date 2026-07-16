export const CURSOR_MARKER = "\x1b_pi:c\x07";
export const RESERVED_TRANSCRIPT_ROWS = 1;

export interface CursorPosition {
  readonly row: number;
  readonly col: number;
}

export interface LineBlock {
  readonly lines: readonly string[];
}

export interface FixedBottomClusterInput {
  readonly width: number;
  readonly terminalRows: number;
  readonly status?: LineBlock;
  readonly aboveWidgets?: readonly LineBlock[];
  readonly editor: LineBlock;
  readonly belowWidgets?: readonly LineBlock[];
  readonly footer?: LineBlock;
}

export interface FixedBottomCluster {
  readonly lines: readonly string[];
  readonly cursor: CursorPosition | null;
}

export interface ViewportState {
  readonly offset: number;
  readonly lineCount: number;
}

export interface ViewportWindow {
  readonly start: number;
  readonly end: number;
  readonly offset: number;
  readonly maxOffset: number;
}

export interface TerminalModeSnapshot {
  readonly active: boolean;
  readonly scrollBottom: number | null;
}

export type VisibleWidth = (text: string) => number;

export interface CursorWidthSemantics {
  readonly cursorMarker: string;
  readonly visibleWidth: VisibleWidth;
}

export interface FixedBottomRenderable {
  render(width: number): string[];
  invalidate?(): void;
  readonly children?: readonly FixedBottomRenderable[];
}

export interface FixedBottomTerminal {
  readonly columns: number;
  readonly rows: number;
  write(data: string): void;
  hideCursor(): void;
  showCursor(): void;
}

export type FixedBottomInputResult = {
  readonly consume?: boolean;
  readonly data?: string;
} | undefined;

export type FixedBottomInputListener = (data: string) => FixedBottomInputResult;

export interface FixedBottomTui extends FixedBottomRenderable {
  readonly terminal: FixedBottomTerminal;
  readonly children: readonly FixedBottomRenderable[];
  stopped: boolean;
  previousLines: string[];
  previousKittyImageIds: Set<number>;
  previousWidth: number;
  previousHeight: number;
  cursorRow: number;
  hardwareCursorRow: number;
  maxLinesRendered: number;
  previousViewportTop: number;
  fullRedrawCount: number;
  doRender(): void;
  start(): void;
  stop(): void;
  requestRender(force?: boolean): void;
  addInputListener(listener: FixedBottomInputListener): () => void;
  hasOverlay(): boolean;
  compositeOverlays(lines: string[], width: number, height: number): string[];
  compositeLineAt(
    baseLine: string,
    overlayLine: string,
    startCol: number,
    overlayWidth: number,
    totalWidth: number,
  ): string;
  getShowHardwareCursor?(): boolean;
}

export interface ProcessExitTarget {
  once(event: "exit", listener: () => void): unknown;
  removeListener(event: "exit", listener: () => void): unknown;
}
