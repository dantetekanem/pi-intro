import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { installFixedBottomCompositor } from "../fixed-bottom/compositor.ts";
import { SUPPORTED_PI_VERSION } from "../fixed-bottom/compatibility.ts";
import { FakeProcess } from "./fixtures/fixed-bottom-fakes.ts";

const INSTALLED_TUI_PATH = "/Users/leonardopereira/Library/pnpm/store/v11/links/@earendil-works/pi-coding-agent/0.80.7/126775c121519a3c3e79695d763647fe6ac8fd88f43a65b24cbf8aefc66bbf00/node_modules/@earendil-works/pi-tui/dist/tui.js";
const installedTui = await import(pathToFileURL(INSTALLED_TUI_PATH).href);

class HarnessTerminal {
  readonly writes: string[] = [];
  private width: number;
  private height: number;

  constructor(columns = 40, rows = 12) {
    this.width = columns;
    this.height = rows;
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
    this.writes.push(data);
  }

  hideCursor(): void {
    this.write("\x1b[?25l");
  }

  showCursor(): void {
    this.write("\x1b[?25h");
  }
}

class HarnessComponent {
  lines: string[];

  constructor(lines: string[]) {
    this.lines = lines;
  }

  render(_width: number): string[] {
    return [...this.lines];
  }

  invalidate(): void {}
}

function occurrences(text: string, value: string): number {
  return text.split(value).length - 1;
}

function assertSafePhysicalWrites(writes: readonly string[]): void {
  for (const output of writes) {
    assert.ok(!output.includes("\x1b[2J"), "real TUI capture leaked CSI 2J");
    assert.ok(!output.includes("\x1b[H"), "real TUI capture leaked standalone CSI H");
    assert.ok(!output.includes("\x1b[3J"), "real TUI capture leaked CSI 3J");
    assert.equal(occurrences(output, "\x1b[?2026h"), 1);
    assert.equal(occurrences(output, "\x1b[?2026l"), 1);
  }
}

function assertClearsRows(output: string, rows: readonly number[]): void {
  for (const row of rows) {
    assert.ok(output.includes(`\x1b[${row};1H\x1b[2K`), `real TUI output did not clear row ${row}`);
  }
}

test("installed real TUI 0.80.7 remains differential and clear-free through compositor lifecycle", () => {
  assert.equal(typeof installedTui.TUI, "function");
  assert.equal(installedTui.CURSOR_MARKER, "\x1b_pi:c\x07");

  const terminal = new HarnessTerminal();
  const tui = new installedTui.TUI(terminal, true);
  const transcript = new HarnessComponent(
    Array.from({ length: 12 }, (_, index) => `real-transcript-${index + 1}`),
  );
  const status = new HarnessComponent(["real-status"]);
  const above = new installedTui.Container();
  const widget = new HarnessComponent(["real-widget"]);
  above.addChild(widget);
  const editor = new installedTui.Container();
  editor.addChild(new HarnessComponent([`real${installedTui.CURSOR_MARKER}editor`]));
  const below = new installedTui.Container();
  below.addChild(new HarnessComponent(["real-below"]));
  const footer = new HarnessComponent(["real-footer", ""]);

  for (const component of [
    transcript,
    new HarnessComponent([]),
    new HarnessComponent([]),
    new HarnessComponent([]),
    status,
    above,
    editor,
    below,
    footer,
  ]) {
    tui.addChild(component);
  }

  // Seed the exact installed renderer's normal full-root state before patching.
  tui.doRender();
  assert.equal(tui.previousHeight, 12);
  terminal.writes.length = 0;

  const processTarget = new FakeProcess();
  const result = installFixedBottomCompositor({
    tui,
    runtimeVersion: SUPPORTED_PI_VERSION,
    semantics: {
      cursorMarker: installedTui.CURSOR_MARKER,
      visibleWidth: installedTui.visibleWidth,
    },
    processTarget,
  });
  assert.equal(result.installed, true, result.installed ? undefined : result.reason);
  if (!result.installed) return;

  assert.equal(tui.previousHeight, 6);
  assert.equal(tui.previousViewportTop, 0);
  assert.equal(tui.previousLines.length, 6);
  assert.match(terminal.writes.at(-1) ?? "", /real-transcript-12/);
  assertSafePhysicalWrites(terminal.writes);

  terminal.setSize(40, 14);
  tui.doRender();
  assert.equal(tui.previousHeight, 8);
  assertClearsRows(terminal.writes.at(-1) ?? "", [7, 8, 9, 10, 11, 12, 13, 14]);

  const overlay = new HarnessComponent(["real-overlay"]);
  tui.overlayStack.push({
    component: overlay,
    options: { row: 1, col: 1, width: 20 },
    preFocus: null,
    hidden: false,
    focusOrder: 1,
  });
  tui.doRender();
  assert.equal(tui.previousHeight, 14);
  assert.match(terminal.writes.at(-1) ?? "", /real-overlay/);

  tui.overlayStack.length = 0;
  tui.doRender();
  assert.equal(tui.previousHeight, 8);
  assert.match(terminal.writes.at(-1) ?? "", /real-transcript-12/);

  widget.lines = ["real-widget-1", "real-widget-2", "real-widget-3"];
  footer.lines = ["real-footer-1", "real-footer-2", ""];
  tui.doRender();
  assertClearsRows(terminal.writes.at(-1) ?? "", [6, 7, 8, 9, 10, 11, 12, 13, 14]);

  terminal.setSize(40, 10);
  result.compositor.dispose();
  assert.equal(result.compositor.disposed, true);
  assert.equal(tui.previousHeight, 10);
  assert.equal(Object.hasOwn(terminal, "rows"), false);
  assert.equal(Object.hasOwn(terminal, "write"), false);
  assert.equal(processTarget.exitListenerCount(), 0);
  assertSafePhysicalWrites(terminal.writes);
});
