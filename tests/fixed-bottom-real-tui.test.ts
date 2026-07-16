import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import test from "node:test";
import {
  installFixedBottomCompositor,
  type FixedBottomCompositor,
} from "../fixed-bottom/compositor.ts";
import { SUPPORTED_PI_VERSION } from "../fixed-bottom/compatibility.ts";
import { FakeProcess } from "./fixtures/fixed-bottom-fakes.ts";

const INSTALLED_TUI_PATH = "/Users/leonardopereira/Library/pnpm/store/v11/links/@earendil-works/pi-coding-agent/0.80.7/126775c121519a3c3e79695d763647fe6ac8fd88f43a65b24cbf8aefc66bbf00/node_modules/@earendil-works/pi-tui/dist/tui.js";
const installedTui = await import(pathToFileURL(INSTALLED_TUI_PATH).href);
const PI_SEGMENT_RESET = "\x1b[0m\x1b]8;;\x07";

class HarnessTerminal {
  readonly writes: string[] = [];
  readonly directWrites: string[] = [];
  readonly orderedEvents: Array<{ kind: "write" | "direct"; data: string }> = [];
  startCallCount = 0;
  stopCallCount = 0;
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
    this.orderedEvents.push({ kind: "write", data });
  }

  start(_onInput: (data: string) => void, _onResize: () => void): void {
    this.startCallCount += 1;
    this.orderedEvents.push({ kind: "direct", data: "terminal:start" });
  }

  hideCursor(): void {
    this.directWrites.push("\x1b[?25l");
    this.orderedEvents.push({ kind: "direct", data: "\x1b[?25l" });
  }

  showCursor(): void {
    this.directWrites.push("\x1b[?25h");
    this.orderedEvents.push({ kind: "direct", data: "\x1b[?25h" });
  }

  stop(): void {
    this.stopCallCount += 1;
    this.directWrites.push("\x1b[?2004l");
    this.orderedEvents.push({ kind: "direct", data: "\x1b[?2004l" });
  }
}

class HarnessComponent {
  lines: string[];
  renderCount = 0;

  constructor(lines: string[]) {
    this.lines = lines;
  }

  render(_width: number): string[] {
    this.renderCount += 1;
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

function clearHarnessLogs(terminal: HarnessTerminal): void {
  terminal.writes.length = 0;
  terminal.directWrites.length = 0;
  terminal.orderedEvents.length = 0;
}

function waitForQueuedRender(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function installRealFixedFixture(): {
  terminal: HarnessTerminal;
  tui: InstanceType<typeof installedTui.TUI>;
  transcript: HarnessComponent;
  widget: HarnessComponent;
  compositor: FixedBottomCompositor;
} {
  const terminal = new HarnessTerminal(40, 12);
  const tui = new installedTui.TUI(terminal, true);
  const transcript = new HarnessComponent(
    Array.from(
      { length: 12 },
      (_, index) => `history-${String(index + 1).padStart(3, "0")}`,
    ),
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

  tui.doRender();
  clearHarnessLogs(terminal);
  const result = installFixedBottomCompositor({
    tui,
    runtimeVersion: SUPPORTED_PI_VERSION,
    semantics: {
      cursorMarker: installedTui.CURSOR_MARKER,
      visibleWidth: installedTui.visibleWidth,
    },
    processTarget: new FakeProcess(),
  });
  assert.equal(result.installed, true, result.installed ? undefined : result.reason);
  if (!result.installed) throw new Error(result.reason);
  return { terminal, tui, transcript, widget, compositor: result.compositor };
}

test("installed real TUI reset clears all physical rows before bounded history", () => {
  const { terminal, tui, widget, compositor } = installRealFixedFixture();
  terminal.writes.length = 0;
  terminal.directWrites.length = 0;

  widget.lines = ["real-widget-1", "real-widget-2", "real-widget-3"];
  tui.doRender();
  const output = terminal.writes.at(-1) ?? "";

  assert.equal(tui.previousHeight, 4);
  assert.deepEqual(
    tui.previousLines.map((line: string) => line.replace(PI_SEGMENT_RESET, "")),
    ["history-009", "history-010", "history-011", "history-012"],
  );
  const firstHistory = output.indexOf("history-009");
  assert.ok(firstHistory >= 0);
  for (let row = 1; row <= 12; row += 1) {
    const clear = output.indexOf(`\x1b[${row};1H\x1b[2K`);
    assert.ok(clear >= 0, `reset did not clear physical row ${row}`);
    assert.ok(clear < firstHistory, `row ${row} clear occurred after bounded history paint`);
  }
  assert.equal(occurrences(output, "\x1b[1;1H"), 2);
  assert.deepEqual(terminal.directWrites, []);
  assertSafePhysicalWrites(terminal.writes);

  compositor.dispose();
});

test("installed real TUI same-height activity update paints only physical row 8", () => {
  const { terminal, tui, widget, compositor } = installRealFixedFixture();
  assert.equal(tui.previousHeight, 6);
  assert.deepEqual(
    tui.previousLines.map((line: string) => line.replace(PI_SEGMENT_RESET, "")),
    [
      "history-007",
      "history-008",
      "history-009",
      "history-010",
      "history-011",
      "history-012",
    ],
  );
  terminal.writes.length = 0;
  terminal.directWrites.length = 0;

  widget.lines = ["real-activity"];
  tui.doRender();
  const output = terminal.writes.at(-1) ?? "";

  assert.deepEqual(
    tui.previousLines.map((line: string) => line.replace(PI_SEGMENT_RESET, "")),
    [
      "history-007",
      "history-008",
      "history-009",
      "history-010",
      "history-011",
      "history-012",
    ],
  );
  assert.ok(output.includes(`\x1b[8;1Hreal-activity${PI_SEGMENT_RESET}\x1b[0K`));
  assert.ok(!output.includes("\x1b[8;1H\x1b[2K"));
  for (const row of [7, 9, 10, 11, 12]) {
    assert.ok(!output.includes(`\x1b[${row};1H`), `unchanged fixed row ${row} was repainted`);
  }
  assert.equal(occurrences(output, "\x1b[?25l"), 0);
  assert.ok(occurrences(output, "\x1b[?25h") <= 1);
  assert.equal(occurrences(output, "\x1b[?25h"), 0);
  assert.equal(occurrences(output, "\x1b[1;1H"), 0);
  assert.deepEqual(terminal.directWrites, []);
  assertSafePhysicalWrites(terminal.writes);

  compositor.dispose();
});

test("installed real TUI forced active render resets rows before bounded history", async () => {
  const { terminal, tui, compositor } = installRealFixedFixture();
  clearHarnessLogs(terminal);

  tui.requestRender(true);
  await waitForQueuedRender();
  const output = terminal.writes.join("");
  const firstHistory = output.indexOf("history-007");
  const rowOneClear = output.indexOf("\x1b[1;1H\x1b[2K");
  const lastRowClear = output.indexOf("\x1b[12;1H\x1b[2K");
  const home = output.lastIndexOf("\x1b[1;1H", firstHistory);

  assert.ok(firstHistory >= 0);
  assert.ok(rowOneClear >= 0 && rowOneClear < firstHistory);
  assert.ok(lastRowClear >= 0 && lastRowClear < firstHistory);
  assert.ok(home > lastRowClear && home < firstHistory);
  assert.equal(occurrences(output, "\x1b[?1049h"), 0);
  assert.ok(!output.includes("\x1b[2J"));
  assert.ok(!output.includes("\x1b[H"));
  assert.ok(!output.includes("\x1b[3J"));

  compositor.dispose();
});

test("installed real TUI quit disposal quiesces an already queued render until original stop", async () => {
  const { terminal, tui, transcript, compositor } = installRealFixedFixture();
  clearHarnessLogs(terminal);
  (tui as any).lastRenderAt = 0;
  const renderCountBeforeQueue = transcript.renderCount;

  tui.requestRender();
  assert.equal((tui as any).renderRequested, true);
  compositor.dispose({ quiesceHost: true });

  const disposalOutput = terminal.writes.join("");
  const alternateScreenOff = disposalOutput.indexOf("\x1b[?1049l");
  assert.ok(alternateScreenOff >= 0);
  assert.equal(occurrences(disposalOutput, "\x1b[?1049l"), 1);
  const afterAlternateScreen = disposalOutput.slice(
    alternateScreenOff + "\x1b[?1049l".length,
  );
  assert.ok(!afterAlternateScreen.includes("\x1b[2K"));
  assert.ok(!afterAlternateScreen.includes("\x1b_G"));
  assert.ok(!afterAlternateScreen.includes("history-"));
  assert.ok(!afterAlternateScreen.includes("real-widget"));
  assert.equal((tui as any).stopped, true);
  assert.equal(transcript.renderCount, renderCountBeforeQueue);
  assert.deepEqual(tui.previousLines, []);
  assert.deepEqual([...tui.previousKittyImageIds], []);
  assert.equal(tui.previousWidth, -1);
  assert.equal(tui.previousHeight, -1);
  assert.equal(tui.cursorRow, 0);
  assert.equal(tui.hardwareCursorRow, 0);
  assert.equal(tui.maxLinesRendered, 0);
  assert.equal(tui.previousViewportTop, 0);
  assert.notEqual(tui.start, installedTui.TUI.prototype.start);
  assert.notEqual(tui.stop, installedTui.TUI.prototype.stop);
  assert.equal(Object.hasOwn(tui, "start"), true);
  assert.equal(Object.hasOwn(tui, "stop"), true);
  assert.equal(terminal.stopCallCount, 0);

  const eventIndexAtDispose = terminal.orderedEvents.length;
  const writeIndexAtDispose = terminal.writes.length;
  const directWriteIndexAtDispose = terminal.directWrites.length;
  await waitForQueuedRender();

  assert.deepEqual(terminal.orderedEvents.slice(eventIndexAtDispose), []);
  assert.deepEqual(terminal.writes.slice(writeIndexAtDispose), []);
  assert.deepEqual(terminal.directWrites.slice(directWriteIndexAtDispose), []);
  assert.equal(transcript.renderCount, renderCountBeforeQueue);
  assert.equal((tui as any).renderRequested, true);
  assert.equal((tui as any).stopped, true);
  assert.deepEqual(tui.previousLines, []);
  assert.deepEqual([...tui.previousKittyImageIds], []);
  assert.equal(tui.previousWidth, -1);
  assert.equal(tui.previousHeight, -1);

  tui.stop();

  assert.equal(terminal.writes.length, writeIndexAtDispose);
  assert.ok(!terminal.writes.slice(writeIndexAtDispose).join("").includes("\r\n"));
  assert.ok(!/\x1b\[\d+[AB]/.test(terminal.writes.slice(writeIndexAtDispose).join("")));
  assert.deepEqual(terminal.directWrites.slice(directWriteIndexAtDispose), [
    "\x1b[?25h",
    "\x1b[?2004l",
  ]);
  assert.equal(terminal.stopCallCount, 1);
  assert.equal(tui.start, installedTui.TUI.prototype.start);
  assert.equal(tui.stop, installedTui.TUI.prototype.stop);
  assert.equal(Object.hasOwn(tui, "start"), false);
  assert.equal(Object.hasOwn(tui, "stop"), false);
});

test("installed real TUI quit guard blocks an external editor's late start", async () => {
  const { terminal, tui, transcript, widget, compositor } = installRealFixedFixture();
  const kittyImage = "\x1b_Gf=100,i=731,r=1;QUJDRA==\x1b\\";
  const deleteKittyImage = "\x1b_Ga=d,d=I,i=731,q=2\x1b\\";
  transcript.lines[7] = kittyImage;
  tui.doRender();
  clearHarnessLogs(terminal);

  tui.stop();
  const externalEditorCleanup = terminal.writes.join("");
  assert.equal(terminal.stopCallCount, 1);
  assert.equal(terminal.startCallCount, 0);
  assert.equal(occurrences(externalEditorCleanup, "\x1b[?1049l"), 1);
  assert.ok(externalEditorCleanup.includes(deleteKittyImage));
  assert.deepEqual(tui.previousLines, []);
  assert.deepEqual([...tui.previousKittyImageIds], []);
  assert.equal(tui.previousWidth, -1);
  assert.equal(tui.previousHeight, -1);

  const writesBeforeDispose = terminal.writes.length;
  const directWritesBeforeDispose = terminal.directWrites.length;
  const eventsBeforeDispose = terminal.orderedEvents.length;
  compositor.dispose({ quiesceHost: true });

  assert.equal(compositor.disposed, true);
  assert.equal(terminal.writes.length, writesBeforeDispose);
  assert.equal(terminal.directWrites.length, directWritesBeforeDispose);
  assert.equal(terminal.orderedEvents.length, eventsBeforeDispose);
  assert.equal(occurrences(terminal.writes.join(""), "\x1b[?1049l"), 1);
  assert.notEqual(tui.start, installedTui.TUI.prototype.start);
  assert.notEqual(tui.stop, installedTui.TUI.prototype.stop);
  assert.equal(Object.hasOwn(tui, "start"), true);
  assert.equal(Object.hasOwn(tui, "stop"), true);

  const guardedStop = tui.stop;
  const eventIndexAtDispose = terminal.orderedEvents.length;
  const writeIndexAtDispose = terminal.writes.length;
  const directWriteIndexAtDispose = terminal.directWrites.length;
  const transcriptRenderCountAtDispose = transcript.renderCount;
  const widgetRenderCountAtDispose = widget.renderCount;
  const startCallCountAtDispose = terminal.startCallCount;
  tui.previousLines = ["late-external-editor-root"];
  tui.previousKittyImageIds = new Set([999]);
  tui.previousWidth = 40;
  tui.previousHeight = 12;
  tui.cursorRow = 7;
  tui.hardwareCursorRow = 8;
  tui.maxLinesRendered = 12;
  tui.previousViewportTop = 3;

  tui.start();
  tui.requestRender(true);
  await waitForQueuedRender();

  assert.equal(terminal.startCallCount, startCallCountAtDispose);
  assert.deepEqual(terminal.orderedEvents.slice(eventIndexAtDispose), []);
  assert.deepEqual(terminal.writes.slice(writeIndexAtDispose), []);
  assert.deepEqual(terminal.directWrites.slice(directWriteIndexAtDispose), []);
  assert.equal(transcript.renderCount, transcriptRenderCountAtDispose);
  assert.equal(widget.renderCount, widgetRenderCountAtDispose);
  assert.equal((tui as any).stopped, true);
  assert.deepEqual(tui.previousLines, []);
  assert.deepEqual([...tui.previousKittyImageIds], []);
  assert.equal(tui.previousWidth, -1);
  assert.equal(tui.previousHeight, -1);
  assert.equal(tui.cursorRow, 0);
  assert.equal(tui.hardwareCursorRow, 0);
  assert.equal(tui.maxLinesRendered, 0);
  assert.equal(tui.previousViewportTop, 0);
  const gapOutput = terminal.writes.slice(writeIndexAtDispose).join("");
  assert.ok(!gapOutput.includes("history-"));
  assert.ok(!gapOutput.includes("real-widget"));
  assert.ok(!gapOutput.includes("\x1b[2K"));
  assert.ok(!gapOutput.includes("\x1b_G"));

  tui.stop();

  assert.equal(terminal.stopCallCount, 2);
  assert.equal(terminal.startCallCount, startCallCountAtDispose);
  const hostStopOutput = terminal.writes.slice(writeIndexAtDispose).join("");
  assert.equal(hostStopOutput, "");
  assert.ok(!hostStopOutput.includes("\r\n"));
  assert.ok(!/\x1b\[\d+[AB]/.test(hostStopOutput));
  assert.deepEqual(terminal.directWrites.slice(directWriteIndexAtDispose), [
    "\x1b[?25h",
    "\x1b[?2004l",
  ]);
  assert.equal(tui.start, installedTui.TUI.prototype.start);
  assert.equal(tui.stop, installedTui.TUI.prototype.stop);
  assert.equal(Object.hasOwn(tui, "start"), false);
  assert.equal(Object.hasOwn(tui, "stop"), false);

  const eventsAfterHostStop = terminal.orderedEvents.length;
  guardedStop();
  assert.equal(terminal.stopCallCount, 2);
  assert.equal(terminal.orderedEvents.length, eventsAfterHostStop);
});

test("installed real TUI stop and start coordinate exact suspended host lifecycle", async () => {
  const { terminal, tui, transcript, widget, compositor } = installRealFixedFixture();
  const transcriptKitty = "\x1b_Gf=100,i=701,r=2;QUJDRA==\x1b\\";
  const fixedKitty = "\x1b_Gf=100,i=702,r=2;RUZHSA==\x1b\\";
  const deleteTranscriptKitty = "\x1b_Ga=d,d=I,i=701,q=2\x1b\\";
  const deleteFixedKitty = "\x1b_Ga=d,d=I,i=702,q=2\x1b\\";
  transcript.lines[7] = transcriptKitty;
  widget.lines = [fixedKitty, ""];
  tui.doRender();
  clearHarnessLogs(terminal);

  tui.stop();
  const stoppedOutput = terminal.writes.join("");
  const transcriptDelete = stoppedOutput.indexOf(deleteTranscriptKitty);
  const fixedDelete = stoppedOutput.indexOf(deleteFixedKitty);
  const firstRowClear = stoppedOutput.indexOf("\x1b[1;1H\x1b[2K");
  const lastRowClear = stoppedOutput.indexOf("\x1b[12;1H\x1b[2K");
  const resetRegion = stoppedOutput.indexOf("\x1b[r");
  const mouse1006Off = stoppedOutput.indexOf("\x1b[?1006l");
  const mouse1002Off = stoppedOutput.indexOf("\x1b[?1002l");
  const mouse1000Off = stoppedOutput.indexOf("\x1b[?1000l");
  const alternateScrollOn = stoppedOutput.indexOf("\x1b[?1007h");
  const alternateScreenOff = stoppedOutput.indexOf("\x1b[?1049l");

  assert.ok(transcriptDelete >= 0 && transcriptDelete < firstRowClear);
  assert.ok(fixedDelete >= 0 && fixedDelete < firstRowClear);
  assertClearsRows(stoppedOutput, Array.from({ length: 12 }, (_, index) => index + 1));
  assert.ok(lastRowClear < resetRegion);
  assert.ok(resetRegion < mouse1006Off);
  assert.ok(mouse1006Off < mouse1002Off);
  assert.ok(mouse1002Off < mouse1000Off);
  assert.ok(mouse1000Off < alternateScrollOn);
  assert.ok(alternateScrollOn < alternateScreenOff);
  assert.equal(occurrences(stoppedOutput, "\x1b[?1049l"), 1);
  assert.ok(!stoppedOutput.includes("\x1b[2J"));
  assert.ok(!stoppedOutput.includes("\x1b[H"));
  assert.ok(!stoppedOutput.includes("\x1b[3J"));
  const afterExit = stoppedOutput.slice(alternateScreenOff + "\x1b[?1049l".length);
  assert.ok(!afterExit.includes("\x1b[2K"));
  assert.ok(!afterExit.includes("\x1b_Ga=d"));
  assert.ok(!/\x1b\[\d+[AB]/.test(afterExit));
  assert.ok(!afterExit.includes("\r\n"));
  assert.equal(terminal.stopCallCount, 1);
  const cleanupEvent = terminal.orderedEvents.findIndex((event) => event.kind === "write");
  const terminalStopEvent = terminal.orderedEvents.findIndex(
    (event) => event.kind === "direct" && event.data === "\x1b[?2004l",
  );
  assert.ok(cleanupEvent >= 0 && cleanupEvent < terminalStopEvent);
  assert.deepEqual(tui.previousLines, []);
  assert.equal(tui.previousWidth, -1);
  assert.equal(tui.previousHeight, -1);

  clearHarnessLogs(terminal);
  tui.start();
  tui.requestRender(true);
  await waitForQueuedRender();
  const resumedOutput = terminal.writes.join("");
  const modeEntry = resumedOutput.indexOf("\x1b[?1049h");
  const alternateScrollOff = resumedOutput.indexOf("\x1b[?1007l");
  const mouse1002On = resumedOutput.indexOf("\x1b[?1002h");
  const mouse1006On = resumedOutput.indexOf("\x1b[?1006h");
  const scrollRegion = resumedOutput.indexOf(`\x1b[1;${tui.previousHeight}r`);
  const resumedHistory = resumedOutput.indexOf(transcriptKitty);
  const resumedLastRowClear = resumedOutput.indexOf("\x1b[12;1H\x1b[2K");
  const resumedHome = resumedOutput.lastIndexOf("\x1b[1;1H", resumedHistory);

  assert.equal(terminal.startCallCount, 1);
  assert.equal(occurrences(resumedOutput, "\x1b[?1049h"), 1);
  assert.ok(modeEntry < alternateScrollOff);
  assert.ok(alternateScrollOff < mouse1002On);
  assert.ok(mouse1002On < mouse1006On);
  assert.ok(mouse1006On < scrollRegion);
  assertClearsRows(resumedOutput, Array.from({ length: 12 }, (_, index) => index + 1));
  assert.ok(resumedLastRowClear < resumedHome);
  assert.ok(resumedHome < resumedHistory);
  assert.ok(resumedOutput.includes(transcriptKitty));
  assert.ok(resumedOutput.includes(fixedKitty));
  assert.ok(!resumedOutput.includes("\x1b[2J"));
  assert.ok(!resumedOutput.includes("\x1b[H"));
  assert.ok(!resumedOutput.includes("\x1b[3J"));

  clearHarnessLogs(terminal);
  tui.stop();
  assert.equal(terminal.stopCallCount, 2);
  assert.equal(occurrences(terminal.writes.join(""), "\x1b[?1049l"), 1);
  const writesAfterSecondStop = terminal.writes.length;
  const directWritesAfterSecondStop = terminal.directWrites.length;
  compositor.dispose();

  assert.equal(compositor.disposed, true);
  assert.equal(terminal.writes.length, writesAfterSecondStop);
  assert.equal(terminal.directWrites.length, directWritesAfterSecondStop);
  assert.equal(terminal.stopCallCount, 2);
  assert.equal(tui.start, installedTui.TUI.prototype.start);
  assert.equal(tui.stop, installedTui.TUI.prototype.stop);
});

test("installed real TUI 0.80.7 bounds long-history overlays through compositor lifecycle", () => {
  assert.equal(typeof installedTui.TUI, "function");
  assert.equal(installedTui.CURSOR_MARKER, "\x1b_pi:c\x07");

  const terminal = new HarnessTerminal();
  const tui = new installedTui.TUI(terminal, true);
  const transcript = new HarnessComponent(
    Array.from(
      { length: 60 },
      (_, index) => `real-history-marker-${String(index + 1).padStart(3, "0")}`,
    ),
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
  terminal.directWrites.length = 0;

  const processTarget = new FakeProcess();
  const originalStop = tui.stop;
  const originalHideCursor = terminal.hideCursor;
  const originalShowCursor = terminal.showCursor;
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
  assert.match(terminal.writes.at(-1) ?? "", /real-history-marker-060/);
  assert.deepEqual(terminal.directWrites, []);
  assert.notEqual(tui.stop, originalStop);
  assert.notEqual(terminal.hideCursor, originalHideCursor);
  assert.notEqual(terminal.showCursor, originalShowCursor);
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
  const overlayOutput = terminal.writes.at(-1) ?? "";
  const overlayFrame = tui.previousLines.join("\n");
  assert.equal(tui.previousHeight, 14);
  assert.ok(tui.previousLines.length <= 14);
  assert.ok((overlayOutput.match(/real-history-marker-\d{3}/g) ?? []).length <= 14);
  assert.ok(!overlayOutput.includes("real-history-marker-001"));
  assert.ok(!overlayFrame.includes("real-history-marker-001"));
  assert.match(overlayOutput, /real-overlay/);
  assert.match(overlayFrame, /real-overlay/);

  tui.overlayStack.length = 0;
  tui.doRender();
  const closedOutput = terminal.writes.at(-1) ?? "";
  assert.equal(tui.previousHeight, 8);
  assert.ok(tui.previousLines.length <= 8);
  assert.match(closedOutput, /real-history-marker-060/);

  const oversizedOptions = { row: 0, col: 0, width: 24 };
  assert.equal("maxHeight" in oversizedOptions, false);
  tui.overlayStack.push({
    component: new HarnessComponent(
      Array.from({ length: 20 }, (_, index) => `oversized-overlay-${index + 1}`),
    ),
    options: oversizedOptions,
    preFocus: null,
    hidden: false,
    focusOrder: 2,
  });
  tui.doRender();
  const oversizedOutput = terminal.writes.at(-1) ?? "";
  assert.equal(tui.previousLines.length, 14);
  assert.match(oversizedOutput, /oversized-overlay-/);

  tui.overlayStack.length = 0;
  tui.doRender();
  assert.ok(tui.previousLines.length <= 8);
  assert.match(terminal.writes.at(-1) ?? "", /real-history-marker-060/);

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
  assert.equal(tui.stop, originalStop);
  assert.equal(terminal.hideCursor, originalHideCursor);
  assert.equal(terminal.showCursor, originalShowCursor);
  assert.equal(processTarget.exitListenerCount(), 0);
  assertSafePhysicalWrites(terminal.writes);
});
