import { EventEmitter } from "node:events";
import { CURSOR_MARKER } from "../../fixed-bottom/contracts.ts";
import type {
  CursorWidthSemantics,
  FixedBottomInputListener,
  FixedBottomRenderable,
  FixedBottomTerminal,
  FixedBottomTui,
} from "../../fixed-bottom/contracts.ts";
import { visibleWidth } from "../../fixed-bottom/line-codec.ts";

export class FakeRenderable implements FixedBottomRenderable {
  renderCount = 0;
  lines: string[];

  constructor(lines: string[]) {
    this.lines = lines;
  }

  render(_width: number): string[] {
    this.renderCount += 1;
    return [...this.lines];
  }

  invalidate(): void {}
}

export class FakeContainer implements FixedBottomRenderable {
  children: FixedBottomRenderable[];

  constructor(children: FixedBottomRenderable[] = []) {
    this.children = children;
  }

  render(width: number): string[] {
    return this.children.flatMap((child) => child.render(width));
  }

  invalidate(): void {}
}

function collectFakeKittyImageIds(lines: readonly string[]): Set<number> {
  const ids = new Set<number>();
  for (const line of lines) {
    for (const match of line.matchAll(/\x1b_G[^;]*\bi=(\d+)[^;]*;/g)) {
      const id = Number(match[1]);
      if (Number.isInteger(id) && id > 0) ids.add(id);
    }
  }
  return ids;
}

export class FakeTerminal implements FixedBottomTerminal {
  readonly writes: string[] = [];
  readonly directWrites: string[] = [];
  startCallCount = 0;
  stopCallCount = 0;
  throwOnWrite = false;
  failOnWriteAttempt: number | null = null;
  recordFailedWrite = false;
  writeAttemptCount = 0;
  private width: number;
  private height: number;

  constructor(width = 40, height = 12) {
    this.width = width;
    this.height = height;
  }

  get columns(): number {
    return this.width;
  }

  get rows(): number {
    return this.height;
  }

  setSize(columns: number, rows: number): void {
    this.width = columns;
    this.height = rows;
  }

  write(data: string): void {
    this.writeAttemptCount += 1;
    if (this.throwOnWrite || this.failOnWriteAttempt === this.writeAttemptCount) {
      if (this.recordFailedWrite) this.writes.push(data);
      throw new Error("terminal write failed");
    }
    this.writes.push(data);
  }

  start(): void {
    this.startCallCount += 1;
  }

  hideCursor(): void {
    this.directWrites.push("\x1b[?25l");
  }

  showCursor(): void {
    this.directWrites.push("\x1b[?25h");
  }

  stop(): void {
    this.stopCallCount += 1;
    this.directWrites.push("\x1b[?2004l");
  }
}

export class FakeTui extends FakeContainer implements FixedBottomTui {
  readonly inputListeners = new Set<FixedBottomInputListener>();
  readonly renderSnapshots: Array<{ rows: number; lines: string[] }> = [];
  previousLines: string[] = [];
  previousKittyImageIds = new Set<number>();
  previousWidth = 0;
  previousHeight = 0;
  cursorRow = 0;
  hardwareCursorRow = 0;
  maxLinesRendered = 0;
  previousViewportTop = 0;
  fullRedrawCount = 0;
  startCallCount = 0;
  requestRenderCount = 0;
  addInputListenerCount = 0;
  removeInputListenerCount = 0;
  overlayVisible = false;
  overlayLines = ["fake-overlay"];
  compositeOverlaysCallCount = 0;
  throwOnCompositeOverlays = false;
  throwOnDoRender = false;
  forceFullRedraw = false;
  showHardwareCursor = true;
  stopped = false;

  readonly terminal: FakeTerminal;

  constructor(terminal: FakeTerminal, children: FixedBottomRenderable[]) {
    super(children);
    this.terminal = terminal;
  }

  doRender(): void {
    if (this.throwOnDoRender) throw new Error("fake render failed");
    const width = this.terminal.columns;
    const height = this.terminal.rows;
    let lines = this.render(width);
    if (this.overlayVisible) {
      lines = this.compositeOverlays(lines, width, height);
    }
    const widthChanged = this.previousWidth !== 0 && this.previousWidth !== width;
    const heightChanged = this.previousHeight !== 0 && this.previousHeight !== height;
    const clear = this.forceFullRedraw || widthChanged || heightChanged;
    this.renderSnapshots.push({ rows: height, lines: [...lines] });
    this.terminal.write(
      `\x1b[?2026h${clear ? "\x1b[2J\x1b[H\x1b[3J" : ""}TUI(rows=${height}):${lines.join("|")}\x1b[?2026l`,
    );
    if (this.showHardwareCursor) this.terminal.showCursor();
    else this.terminal.hideCursor();

    if (this.previousLines.length === 0 || clear) this.fullRedrawCount += 1;
    this.previousLines = [...lines];
    this.previousKittyImageIds = collectFakeKittyImageIds(lines);
    this.previousWidth = width;
    this.previousHeight = height;
    this.cursorRow = Math.max(0, lines.length - 1);
    this.hardwareCursorRow = this.cursorRow;
    this.maxLinesRendered = clear
      ? lines.length
      : Math.max(this.maxLinesRendered, lines.length);
    this.previousViewportTop = Math.max(0, lines.length - height);
  }

  seedRenderState(lines: readonly string[] = ["seeded-normal-root"]): void {
    this.previousLines = [...lines];
    this.previousKittyImageIds = collectFakeKittyImageIds(lines);
    this.previousWidth = this.terminal.columns;
    this.previousHeight = this.terminal.rows;
    this.cursorRow = Math.max(0, lines.length - 1);
    this.hardwareCursorRow = this.cursorRow;
    this.maxLinesRendered = lines.length;
    this.previousViewportTop = Math.max(0, lines.length - this.terminal.rows);
  }

  start(): void {
    this.startCallCount += 1;
    this.stopped = false;
    this.terminal.start();
    this.terminal.hideCursor();
    this.requestRender();
  }

  stop(): void {
    this.stopped = true;
    this.terminal.showCursor();
    this.terminal.stop();
  }

  requestRender(force = false): void {
    this.requestRenderCount += 1;
    if (!force) return;
    this.previousLines = [];
    this.previousWidth = -1;
    this.previousHeight = -1;
    this.cursorRow = 0;
    this.hardwareCursorRow = 0;
    this.maxLinesRendered = 0;
    this.previousViewportTop = 0;
  }

  addInputListener(listener: FixedBottomInputListener): () => void {
    this.addInputListenerCount += 1;
    this.inputListeners.add(listener);
    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      this.removeInputListenerCount += 1;
      this.inputListeners.delete(listener);
    };
  }

  hasOverlay(): boolean {
    return this.overlayVisible;
  }

  compositeOverlays(lines: string[], width: number, height: number): string[] {
    this.compositeOverlaysCallCount += 1;
    if (this.throwOnCompositeOverlays) throw new Error("fake overlay composition failed");

    const result = [...lines];
    const workingHeight = Math.max(result.length, height, this.overlayLines.length);
    while (result.length < workingHeight) result.push("");
    const viewportStart = Math.max(0, workingHeight - height);
    for (let index = 0; index < this.overlayLines.length; index += 1) {
      const target = viewportStart + index;
      if (target >= result.length) break;
      result[target] = this.compositeLineAt(
        result[target],
        this.overlayLines[index],
        0,
        width,
        width,
      );
    }
    return result;
  }

  compositeLineAt(
    baseLine: string,
    overlayLine: string,
    startCol: number,
    _overlayWidth: number,
    _totalWidth: number,
  ): string {
    return `${baseLine.slice(0, startCol)}${overlayLine}`;
  }

  getShowHardwareCursor(): boolean {
    return this.showHardwareCursor;
  }

  emitInput(data: string): { consumed: boolean; data: string } {
    let current = data;
    for (const listener of this.inputListeners) {
      const result = listener(current);
      if (result?.consume) return { consumed: true, data: current };
      if (result?.data !== undefined) current = result.data;
    }
    return { consumed: false, data: current };
  }
}

export class FakeProcess extends EventEmitter {
  exitListenerCount(): number {
    return this.listenerCount("exit");
  }
}

export interface FakeRoot {
  readonly children: FixedBottomRenderable[];
  readonly transcript: FakeRenderable;
  readonly status: FakeContainer;
  readonly above: FakeContainer;
  readonly editor: FakeContainer;
  readonly below: FakeContainer;
  readonly footer: FakeRenderable;
  readonly widget: FakeRenderable;
  readonly editorBody: FakeRenderable;
}

export function createFakeRoot(
  transcriptLines: string[] = Array.from({ length: 12 }, (_, index) => `transcript-${index + 1}`),
): FakeRoot {
  const transcript = new FakeRenderable(transcriptLines);
  const status = new FakeContainer([new FakeRenderable(["status"])]);
  const widget = new FakeRenderable(["above-widget"]);
  const above = new FakeContainer([widget]);
  const editorBody = new FakeRenderable([`edit${CURSOR_MARKER}or`]);
  const editor = new FakeContainer([editorBody]);
  const below = new FakeContainer([new FakeRenderable(["below-widget"])]);
  const footer = new FakeRenderable(["footer", ""]);

  return {
    children: [
      transcript,
      new FakeContainer(),
      new FakeContainer(),
      new FakeContainer(),
      status,
      above,
      editor,
      below,
      footer,
    ],
    transcript,
    status,
    above,
    editor,
    below,
    footer,
    widget,
    editorBody,
  };
}

export function publicSemantics(): CursorWidthSemantics {
  return {
    cursorMarker: CURSOR_MARKER,
    visibleWidth,
  };
}
