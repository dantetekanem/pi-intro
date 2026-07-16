import assert from "node:assert/strict";
import test from "node:test";
import {
  installFixedBottomCompositor,
  tailRows,
  type FixedBottomCompositor,
} from "../fixed-bottom/compositor.ts";
import {
  createFakeRoot,
  FakeProcess,
  FakeRenderable,
  FakeTerminal,
  FakeTui,
  publicSemantics,
} from "./fixtures/fixed-bottom-fakes.ts";

const PI_SEGMENT_RESET = "\x1b[0m\x1b]8;;\x07";

function installFixture(rows = 12): {
  terminal: FakeTerminal;
  tui: FakeTui;
  processTarget: FakeProcess;
  root: ReturnType<typeof createFakeRoot>;
  compositor: FixedBottomCompositor;
} {
  const root = createFakeRoot();
  const terminal = new FakeTerminal(40, rows);
  const tui = new FakeTui(terminal, root.children);
  tui.seedRenderState(["normal-root-before-install"]);
  const processTarget = new FakeProcess();
  const result = installFixedBottomCompositor({
    tui,
    semantics: publicSemantics(),
    processTarget,
  });
  assert.equal(result.installed, true, result.installed ? undefined : result.reason);
  if (!result.installed) throw new Error(result.reason);
  return { terminal, tui, processTarget, root, compositor: result.compositor };
}

function occurrences(text: string, value: string): number {
  return text.split(value).length - 1;
}

function tuiRenderState(tui: FakeTui): object {
  return {
    previousLines: [...tui.previousLines],
    previousKittyImageIds: [...tui.previousKittyImageIds],
    previousWidth: tui.previousWidth,
    previousHeight: tui.previousHeight,
    cursorRow: tui.cursorRow,
    hardwareCursorRow: tui.hardwareCursorRow,
    maxLinesRendered: tui.maxLinesRendered,
    previousViewportTop: tui.previousViewportTop,
    fullRedrawCount: tui.fullRedrawCount,
  };
}

function assertSafeWrites(writes: readonly string[]): void {
  for (const output of writes) {
    assert.ok(!output.includes("\x1b[2J"), "must not physically write CSI 2J");
    assert.ok(!output.includes("\x1b[H"), "must not physically write standalone CSI H");
    assert.ok(!output.includes("\x1b[3J"), "must not physically write CSI 3J");
    assert.ok(output.startsWith("\x1b[?2026h"));
    assert.ok(output.endsWith("\x1b[?2026l"));
    assert.equal(occurrences(output, "\x1b[?2026h"), 1);
    assert.equal(occurrences(output, "\x1b[?2026l"), 1);
  }

  const joined = writes.join("");
  const alternateScreenOff = joined.indexOf("\x1b[?1049l");
  if (alternateScreenOff !== -1) {
    const afterRestore = joined.slice(alternateScreenOff + "\x1b[?1049l".length);
    assert.ok(!afterRestore.includes("\x1b[2K"), "must not erase cells after CSI ?1049l");
    assert.ok(!afterRestore.includes("\x1b[0K"), "must not erase line tails after CSI ?1049l");
    assert.ok(!afterRestore.includes("\x1b_Ga=d"), "must not delete Kitty images after CSI ?1049l");
  }
}

function assertClearsRows(output: string, rows: readonly number[]): void {
  for (const row of rows) {
    assert.ok(output.includes(`\x1b[${row};1H\x1b[2K`), `expected an explicit clear for row ${row}`);
  }
}

function assertPrimaryClearedBeforeAlternateScreen(output: string, rows: number): void {
  const alternateScreenOn = output.indexOf("\x1b[?1049h");
  assert.ok(alternateScreenOn >= 0, "expected alternate-screen entry");
  for (let row = 1; row <= rows; row += 1) {
    const clear = output.indexOf(`\x1b[${row};1H\x1b[2K`);
    assert.ok(clear >= 0 && clear < alternateScreenOn, `primary row ${row} was not cleared before entry`);
  }
}

test("tailRows returns a bounded copy without mutating its input", () => {
  const lines = ["one", "two", "three", "four"];

  assert.deepEqual(tailRows(lines, 2), ["three", "four"]);
  assert.deepEqual(tailRows(lines, 20), lines);
  assert.deepEqual(tailRows(lines, 0), []);
  assert.deepEqual(lines, ["one", "two", "three", "four"]);
});

test("install paints the transcript reservation and canonical cluster at the terminal bottom", () => {
  const { terminal, tui, compositor } = installFixture();

  assert.equal(terminal.writes.length, 1);
  const output = terminal.writes[0];
  assertPrimaryClearedBeforeAlternateScreen(output, 12);
  assert.match(output, /\x1b\[1;6r/);
  assert.ok(output.includes("\x1b[?1002h\x1b[?1006h"));
  assert.match(output, /TUI\(rows=6\):transcript-7\|transcript-8\|transcript-9\|transcript-10\|transcript-11\|transcript-12/);
  assert.ok(output.includes(`\x1b[7;1Hstatus${PI_SEGMENT_RESET}\x1b[0K`));
  assert.ok(output.includes(`\x1b[8;1Habove-widget${PI_SEGMENT_RESET}\x1b[0K`));
  assert.ok(output.includes(`\x1b[9;1Heditor${PI_SEGMENT_RESET}\x1b[0K`));
  assert.ok(output.includes(`\x1b[10;1Hbelow-widget${PI_SEGMENT_RESET}\x1b[0K`));
  assert.ok(output.includes(`\x1b[11;1Hfooter${PI_SEGMENT_RESET}\x1b[0K`));
  assert.equal(occurrences(output, "footer"), 1);
  assert.equal(terminal.rows, 6);
  assert.equal(tui.hardwareCursorRow, 8);

  compositor.dispose();
});

test("fixed renders preserve stable Kitty IDs and delete only replaced or removed IDs", () => {
  const { terminal, tui, root, compositor } = installFixture();
  const kitty77 = "\x1b_Gf=100,i=77,r=2;QUJDRA==\x1b\\";
  const changedKitty77 = "\x1b_Gf=100,i=77,r=2;RUZHSA==\x1b\\";
  const kitty88 = "\x1b_Gf=100,i=88,r=2;SUpLTA==\x1b\\";
  const delete77 = "\x1b_Ga=d,d=I,i=77,q=2\x1b\\";
  const delete88 = "\x1b_Ga=d,d=I,i=88,q=2\x1b\\";
  root.widget.lines = [kitty77, ""];
  tui.children[8] = new FakeRenderable(["updated-footer", ""]);

  tui.doRender();
  const initialImageOutput = terminal.writes.at(-1) ?? "";
  assert.equal(occurrences(initialImageOutput, kitty77), 1);
  assert.equal(occurrences(initialImageOutput, "updated-footer"), 1);

  tui.doRender();
  const stableImageOutput = terminal.writes.at(-1) ?? "";
  assert.equal(occurrences(stableImageOutput, kitty77), 0);
  assert.ok(!stableImageOutput.includes(delete77));
  for (const row of [7, 8, 9, 10, 11, 12]) {
    assert.equal(
      occurrences(stableImageOutput, `\x1b[${row};1H`),
      0,
      `stable frame must not clear or repaint fixed row ${row}`,
    );
  }

  root.widget.lines = [changedKitty77, ""];
  tui.doRender();
  const changedSameIdOutput = terminal.writes.at(-1) ?? "";
  assert.equal(occurrences(changedSameIdOutput, delete77), 1);
  assert.equal(occurrences(changedSameIdOutput, changedKitty77), 1);
  assert.ok(changedSameIdOutput.indexOf(delete77) < changedSameIdOutput.indexOf(changedKitty77));

  root.widget.lines = [kitty88, ""];
  tui.doRender();
  const replacedImageOutput = terminal.writes.at(-1) ?? "";
  assert.equal(occurrences(replacedImageOutput, kitty88), 1);
  assert.ok(replacedImageOutput.includes(delete77));
  assert.ok(!replacedImageOutput.includes(delete88));

  root.widget.lines = [];
  tui.doRender();
  const removedImageOutput = terminal.writes.at(-1) ?? "";
  assert.ok(removedImageOutput.includes(delete88));
  assert.ok(!removedImageOutput.includes(kitty88));

  compositor.dispose();
});

test("overlay handoff deletes image IDs owned only by the prior overlay frame", () => {
  const { terminal, tui, root, compositor } = installFixture();
  const kitty77 = "\x1b_Gf=100,i=77,r=2;QUJDRA==\x1b\\";
  const delete77 = "\x1b_Ga=d,d=I,i=77,q=2\x1b\\";

  root.widget.lines = [kitty77, ""];
  tui.overlayVisible = true;
  tui.doRender();
  const opened = terminal.writes.at(-1) ?? "";
  assert.equal(occurrences(opened, kitty77), 1);

  root.widget.lines = [];
  tui.overlayVisible = false;
  tui.doRender();
  const closed = terminal.writes.at(-1) ?? "";
  assert.ok(closed.includes(delete77));
  assert.ok(!closed.includes(kitty77));

  compositor.dispose();
});

test("overlay entry deletes image IDs owned only by the prior fixed transcript frame", () => {
  const { terminal, tui, root, compositor } = installFixture();
  const kitty77 = "\x1b_Gf=100,i=77,r=2;QUJDRA==\x1b\\";
  const delete77 = "\x1b_Ga=d,d=I,i=77,q=2\x1b\\";
  const transcriptLines = Array.from(
    { length: 12 },
    (_, index) => `transcript-${index + 1}`,
  );
  transcriptLines[6] = kitty77;
  root.transcript.lines = transcriptLines;

  tui.doRender();
  const fixed = terminal.writes.at(-1) ?? "";
  assert.equal(occurrences(fixed, kitty77), 1);
  assert.ok(tui.previousKittyImageIds.has(77));

  tui.overlayVisible = true;
  tui.doRender();
  const opened = terminal.writes.at(-1) ?? "";
  assert.equal(occurrences(opened, delete77), 1);
  assert.ok(!opened.includes(kitty77));

  compositor.dispose();
});

test("fixed resize deletes image IDs omitted from the replacement transcript frame", () => {
  const { terminal, tui, root, compositor } = installFixture();
  const kitty77 = "\x1b_Gf=100,i=77,r=2;QUJDRA==\x1b\\";
  const delete77 = "\x1b_Ga=d,d=I,i=77,q=2\x1b\\";
  const transcriptLines = Array.from(
    { length: 12 },
    (_, index) => `transcript-${index + 1}`,
  );
  transcriptLines[6] = kitty77;
  root.transcript.lines = transcriptLines;

  tui.doRender();
  assert.ok((terminal.writes.at(-1) ?? "").includes(kitty77));
  assert.ok(tui.previousKittyImageIds.has(77));

  terminal.setSize(40, 10);
  tui.doRender();
  const resized = terminal.writes.at(-1) ?? "";
  assert.equal(occurrences(resized, delete77), 1);
  assert.ok(!resized.includes(kitty77));

  compositor.dispose();
});

test("visible overlays temporarily release the scroll region without switching screen buffers", () => {
  const { terminal, tui, compositor } = installFixture();

  tui.overlayVisible = true;
  tui.doRender();
  const suspended = terminal.writes.at(-1) ?? "";
  assert.equal(tui.compositeOverlaysCallCount, 1);
  assert.ok(tui.previousLines.length <= 12);
  assert.ok(suspended.includes("\x1b[r"));
  assert.ok(!suspended.includes("\x1b[?1049l"));
  assert.ok(!suspended.includes("\x1b[?1007h"));
  assertClearsRows(suspended, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.match(suspended, /TUI\(rows=12\):/);
  assert.match(suspended, /fake-overlay/);
  assert.equal(occurrences(suspended, "footer"), 1);
  assert.equal(terminal.rows, 12);
  assert.deepEqual(tui.emitInput("\x1b[5~"), { consumed: false, data: "\x1b[5~" });
  assert.deepEqual(tui.emitInput("\x1b[<64;20;10M"), {
    consumed: true,
    data: "\x1b[<64;20;10M",
  });

  tui.overlayVisible = false;
  tui.doRender();
  const resumed = terminal.writes.at(-1) ?? "";
  assert.ok(!resumed.includes("\x1b[?1049h"));
  assert.ok(resumed.includes("\x1b[1;6r"));
  assertClearsRows(resumed, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.match(resumed, /TUI\(rows=6\):/);
  assert.equal(terminal.rows, 6);

  compositor.dispose();
});

test("resize updates the scroll region and keeps the cluster bottom-aligned", () => {
  const { terminal, tui, compositor } = installFixture();
  terminal.setSize(50, 10);

  tui.doRender();
  const output = terminal.writes.at(-1) ?? "";
  assert.ok(output.includes("\x1b[r\x1b[1;4r"));
  assert.match(output, /TUI\(rows=4\):transcript-9\|transcript-10\|transcript-11\|transcript-12/);
  assert.ok(output.includes(`\x1b[5;1Hstatus${PI_SEGMENT_RESET}\x1b[0K`));
  assert.ok(output.includes(`\x1b[9;1Hfooter${PI_SEGMENT_RESET}\x1b[0K`));
  assert.equal(terminal.rows, 4);
  assertSafeWrites(terminal.writes);

  compositor.dispose();
});

test("keyboard and tmux SGR wheel input scroll the transcript without taking ordinary arrows", () => {
  const { terminal, tui, compositor } = installFixture();

  assert.deepEqual(tui.emitInput("\x1b[5~"), { consumed: true, data: "\x1b[5~" });
  assert.equal(tui.requestRenderCount, 1);
  tui.doRender();
  assert.match(
    terminal.writes.at(-1) ?? "",
    /TUI\(rows=6\):transcript-2\|transcript-3\|transcript-4\|transcript-5\|transcript-6\|transcript-7/,
  );

  assert.deepEqual(tui.emitInput("\x1b[A"), { consumed: false, data: "\x1b[A" });
  assert.equal(tui.requestRenderCount, 1);
  assert.deepEqual(tui.emitInput("\x1b[6~"), { consumed: true, data: "\x1b[6~" });
  tui.doRender();
  assert.match(
    terminal.writes.at(-1) ?? "",
    /TUI\(rows=6\):transcript-7\|transcript-8\|transcript-9\|transcript-10\|transcript-11\|transcript-12/,
  );

  assert.deepEqual(tui.emitInput("\x1b[<64;20;10M"), {
    consumed: true,
    data: "\x1b[<64;20;10M",
  });
  tui.doRender();
  assert.match(
    terminal.writes.at(-1) ?? "",
    /TUI\(rows=6\):transcript-4\|transcript-5\|transcript-6\|transcript-7\|transcript-8\|transcript-9/,
  );

  compositor.dispose();
});

test("jumpToBottom follows the viewport bottom and repaint delegates to TUI requestRender", () => {
  const { terminal, tui, compositor } = installFixture();

  assert.deepEqual(tui.emitInput("\x1b[5~"), { consumed: true, data: "\x1b[5~" });
  tui.doRender();
  assert.match(
    terminal.writes.at(-1) ?? "",
    /TUI\(rows=6\):transcript-2\|transcript-3\|transcript-4\|transcript-5\|transcript-6\|transcript-7/,
  );

  compositor.jumpToBottom();
  assert.equal(tui.requestRenderCount, 2);
  tui.doRender();
  assert.match(
    terminal.writes.at(-1) ?? "",
    /TUI\(rows=6\):transcript-7\|transcript-8\|transcript-9\|transcript-10\|transcript-11\|transcript-12/,
  );

  compositor.requestRepaint();
  assert.equal(tui.requestRenderCount, 3);

  compositor.dispose();
});

test("positions the hardware cursor from the public cursor marker", () => {
  const { terminal, compositor } = installFixture();
  const output = terminal.writes[0];

  assert.ok(!output.includes("\x1b_pi:c\x07"));
  assert.ok(output.includes("\x1b[9;5H\x1b[?25h"));
  assert.deepEqual(terminal.directWrites, []);

  compositor.dispose();
});

test("preflight failure does not emit an unconditional terminal reset", () => {
  const root = createFakeRoot();
  const terminal = new FakeTerminal();
  const tui = new FakeTui(terminal, root.children);
  const processTarget = new FakeProcess();
  tui.seedRenderState(["preflight-state"]);
  const initialState = tuiRenderState(tui);

  const result = installFixedBottomCompositor({
    tui,
    semantics: { ...publicSemantics(), cursorMarker: "incompatible-marker" },
    processTarget,
  });

  assert.equal(result.installed, false);
  assert.deepEqual(terminal.writes, []);
  assert.equal(tui.addInputListenerCount, 0);
  assert.equal(processTarget.exitListenerCount(), 0);
  assert.equal(Object.hasOwn(terminal, "rows"), false);
  assert.equal(Object.hasOwn(terminal, "write"), false);
  assert.deepEqual(tuiRenderState(tui), initialState);
});

test("write failure after mode entry best-effort restores modes and rolls back hooks and patches", () => {
  class WriteThenThrowTerminal extends FakeTerminal {
    private failed = false;

    override write(data: string): void {
      this.writes.push(data);
      if (!this.failed) {
        this.failed = true;
        throw new Error("terminal write failed after output");
      }
    }
  }

  const root = createFakeRoot();
  const terminal = new WriteThenThrowTerminal();
  const tui = new FakeTui(terminal, root.children);
  const processTarget = new FakeProcess();
  const originalDoRender = tui.doRender;
  tui.seedRenderState(["initial-write-state"]);
  const initialState = tuiRenderState(tui);

  const result = installFixedBottomCompositor({
    tui,
    semantics: publicSemantics(),
    processTarget,
  });

  assert.equal(result.installed, false);
  assert.equal(terminal.writes.length, 2);
  assert.ok(terminal.writes[0].includes("\x1b[?1049h"));
  assert.ok(terminal.writes[0].includes("\x1b[?1002h\x1b[?1006h"));
  assert.ok(terminal.writes[1].includes("\x1b[?1006l\x1b[?1002l\x1b[?1000l"));
  assert.ok(terminal.writes[1].includes("\x1b[?1049l"));
  for (const output of terminal.writes) {
    assert.equal(occurrences(output, "\x1b[?2026h"), 1);
    assert.equal(occurrences(output, "\x1b[?2026l"), 1);
  }
  assert.equal(tui.doRender, originalDoRender);
  assert.equal(tui.inputListeners.size, 0);
  assert.equal(tui.removeInputListenerCount, 1);
  assert.equal(processTarget.exitListenerCount(), 0);
  assert.equal(Object.hasOwn(terminal, "rows"), false);
  assert.equal(Object.hasOwn(terminal, "write"), false);
  assert.deepEqual(tuiRenderState(tui), initialState);
  assertSafeWrites(terminal.writes);
});

test("initial render failure rolls back every patch and registered hook without writing", () => {
  const root = createFakeRoot();
  const terminal = new FakeTerminal();
  const tui = new FakeTui(terminal, root.children);
  const processTarget = new FakeProcess();
  const methods = {
    render: tui.render,
    doRender: tui.doRender,
    compositeOverlays: tui.compositeOverlays,
    compositeLineAt: tui.compositeLineAt,
  };
  tui.seedRenderState(["initial-render-state"]);
  const initialState = tuiRenderState(tui);
  tui.throwOnDoRender = true;

  const result = installFixedBottomCompositor({
    tui,
    semantics: publicSemantics(),
    processTarget,
  });

  assert.equal(result.installed, false);
  assert.deepEqual(terminal.writes, []);
  assert.equal(tui.inputListeners.size, 0);
  assert.equal(tui.addInputListenerCount, 1);
  assert.equal(tui.removeInputListenerCount, 1);
  assert.equal(processTarget.exitListenerCount(), 0);
  assert.equal(tui.render, methods.render);
  assert.equal(tui.doRender, methods.doRender);
  assert.equal(tui.compositeOverlays, methods.compositeOverlays);
  assert.equal(tui.compositeLineAt, methods.compositeLineAt);
  assert.equal(Object.hasOwn(terminal, "rows"), false);
  assert.equal(Object.hasOwn(terminal, "write"), false);
  assert.deepEqual(tuiRenderState(tui), initialState);
});

test("overlay composition failure is fail-closed before any body write", () => {
  const root = createFakeRoot();
  const terminal = new FakeTerminal();
  const tui = new FakeTui(terminal, root.children);
  const processTarget = new FakeProcess();
  const methods = {
    render: tui.render,
    doRender: tui.doRender,
    compositeOverlays: tui.compositeOverlays,
    compositeLineAt: tui.compositeLineAt,
  };
  tui.seedRenderState(["committed-before-overlay-failure"]);
  const initialState = tuiRenderState(tui);
  tui.overlayVisible = true;
  tui.throwOnCompositeOverlays = true;

  const result = installFixedBottomCompositor({
    tui,
    semantics: publicSemantics(),
    processTarget,
  });

  assert.equal(result.installed, false);
  assert.match(result.installed ? "" : result.reason, /overlay composition failed/);
  assert.deepEqual(terminal.writes, []);
  assert.deepEqual(tuiRenderState(tui), initialState);
  assert.equal(tui.render, methods.render);
  assert.equal(tui.doRender, methods.doRender);
  assert.equal(tui.compositeOverlays, methods.compositeOverlays);
  assert.equal(tui.compositeLineAt, methods.compositeLineAt);
  assert.equal(tui.inputListeners.size, 0);
  assert.equal(tui.removeInputListenerCount, 1);
  assert.equal(processTarget.exitListenerCount(), 0);
  assert.equal(Object.hasOwn(terminal, "rows"), false);
  assert.equal(Object.hasOwn(terminal, "write"), false);
});

test("physical row invariant rejects oversized renderer state while output is captured", () => {
  class OversizedStateTui extends FakeTui {
    override doRender(): void {
      super.doRender();
      this.previousLines.push("overflow-row");
    }
  }

  const root = createFakeRoot();
  const terminal = new FakeTerminal();
  const tui = new OversizedStateTui(terminal, root.children);
  const processTarget = new FakeProcess();
  const methods = {
    render: tui.render,
    doRender: tui.doRender,
    start: tui.start,
    stop: tui.stop,
    compositeOverlays: tui.compositeOverlays,
    compositeLineAt: tui.compositeLineAt,
    hideCursor: terminal.hideCursor,
    showCursor: terminal.showCursor,
  };
  tui.seedRenderState(["committed-before-row-overflow"]);
  const initialState = tuiRenderState(tui);

  const result = installFixedBottomCompositor({
    tui,
    semantics: publicSemantics(),
    processTarget,
  });

  assert.equal(result.installed, false);
  assert.match(result.installed ? "" : result.reason, /rejected 7 rendered rows for 6-row fixed surface/);
  assert.deepEqual(terminal.writes, []);
  assert.deepEqual(terminal.directWrites, []);
  assert.equal(terminal.stopCallCount, 0);
  assert.equal(tui.stopped, false);
  assert.deepEqual(tuiRenderState(tui), initialState);
  assert.equal(tui.render, methods.render);
  assert.equal(tui.doRender, methods.doRender);
  assert.equal(tui.start, methods.start);
  assert.equal(tui.stop, methods.stop);
  assert.equal(tui.compositeOverlays, methods.compositeOverlays);
  assert.equal(tui.compositeLineAt, methods.compositeLineAt);
  assert.equal(terminal.hideCursor, methods.hideCursor);
  assert.equal(terminal.showCursor, methods.showCursor);
  assert.equal(tui.inputListeners.size, 0);
  assert.equal(processTarget.exitListenerCount(), 0);
});

test("over-width render suppresses TUI stop side effects before fail-closed restoration", () => {
  class OverWidthTui extends FakeTui {
    override doRender(): void {
      const lines = this.render(this.terminal.columns);
      if (lines.some((line) => line.length > this.terminal.columns)) {
        this.stop();
        throw new Error("rendered line exceeds terminal width");
      }
      super.doRender();
    }
  }

  const root = createFakeRoot();
  const terminal = new FakeTerminal();
  const tui = new OverWidthTui(terminal, root.children);
  const processTarget = new FakeProcess();
  const originalStop = tui.stop;
  const originalHideCursor = terminal.hideCursor;
  const originalShowCursor = terminal.showCursor;
  const result = installFixedBottomCompositor({
    tui,
    semantics: publicSemantics(),
    processTarget,
  });
  assert.equal(result.installed, true, result.installed ? undefined : result.reason);
  if (!result.installed) return;

  root.transcript.lines = ["x".repeat(terminal.columns + 1)];
  assert.doesNotThrow(() => tui.doRender());

  assert.equal(result.compositor.disposed, true);
  assert.equal(tui.stopped, false);
  assert.equal(terminal.stopCallCount, 0);
  assert.deepEqual(terminal.directWrites, []);
  assert.ok(terminal.writes.every((output) => !output.includes("x".repeat(terminal.columns + 1))));
  assert.equal(tui.stop, originalStop);
  assert.equal(terminal.hideCursor, originalHideCursor);
  assert.equal(terminal.showCursor, originalShowCursor);
  assert.equal(Object.hasOwn(terminal, "rows"), false);
  assert.equal(Object.hasOwn(terminal, "write"), false);
});

test("active duplicate start is an idempotent host lifecycle no-op", () => {
  const { terminal, tui, compositor } = installFixture();
  const writesBeforeStart = terminal.writes.length;
  const directWritesBeforeStart = terminal.directWrites.length;

  tui.start();

  assert.equal(tui.startCallCount, 0);
  assert.equal(terminal.startCallCount, 0);
  assert.equal(terminal.writes.length, writesBeforeStart);
  assert.equal(terminal.directWrites.length, directWritesBeforeStart);

  compositor.dispose();
});

test("stop then dispose restores modes and terminal lifecycle exactly once", () => {
  const { terminal, tui, compositor } = installFixture();

  tui.stop();
  const cleanup = terminal.writes.at(-1) ?? "";
  const writesAfterStop = terminal.writes.length;
  const directWritesAfterStop = terminal.directWrites.length;
  assert.equal(occurrences(cleanup, "\x1b[?1049l"), 1);
  assert.equal(terminal.stopCallCount, 1);
  assert.deepEqual(tui.previousLines, []);
  assert.deepEqual([...tui.previousKittyImageIds], []);
  assert.equal(tui.previousWidth, -1);
  assert.equal(tui.previousHeight, -1);
  assert.equal(tui.cursorRow, 0);
  assert.equal(tui.hardwareCursorRow, 0);
  assert.equal(tui.maxLinesRendered, 0);
  assert.equal(tui.previousViewportTop, 0);

  tui.stop();
  assert.equal(terminal.writes.length, writesAfterStop);
  assert.equal(terminal.directWrites.length, directWritesAfterStop);
  assert.equal(terminal.stopCallCount, 1);

  compositor.dispose();
  assert.equal(compositor.disposed, true);
  assert.equal(terminal.writes.length, writesAfterStop);
  assert.equal(terminal.directWrites.length, directWritesAfterStop);
  assert.equal(terminal.stopCallCount, 1);
  assert.equal(tui.start, FakeTui.prototype.start);
  assert.equal(tui.stop, FakeTui.prototype.stop);
});

test("dispose then stop restores compositor mode once and delegates terminal stop once", () => {
  const { terminal, tui, compositor } = installFixture();

  compositor.dispose();
  assert.equal(occurrences(terminal.writes.join(""), "\x1b[?1049l"), 1);
  assert.equal(terminal.stopCallCount, 0);
  assert.equal(tui.stopped, false);

  tui.stop();
  assert.equal(occurrences(terminal.writes.join(""), "\x1b[?1049l"), 1);
  assert.equal(terminal.stopCallCount, 1);
});

test("quit disposal installs active host guards until original stop", () => {
  const { terminal, tui, compositor } = installFixture();

  compositor.dispose({ quiesceHost: true });

  assert.equal(compositor.disposed, true);
  assert.equal(tui.stopped, true);
  assert.deepEqual(tui.previousLines, []);
  assert.deepEqual([...tui.previousKittyImageIds], []);
  assert.equal(tui.previousWidth, -1);
  assert.equal(tui.previousHeight, -1);
  assert.equal(tui.cursorRow, 0);
  assert.equal(tui.hardwareCursorRow, 0);
  assert.equal(tui.maxLinesRendered, 0);
  assert.equal(tui.previousViewportTop, 0);
  assert.equal(occurrences(terminal.writes.join(""), "\x1b[?1049l"), 1);
  assert.equal(terminal.stopCallCount, 0);
  assert.notEqual(tui.start, FakeTui.prototype.start);
  assert.notEqual(tui.stop, FakeTui.prototype.stop);
  assert.equal(Object.hasOwn(tui, "start"), true);
  assert.equal(Object.hasOwn(tui, "stop"), true);

  const guardedStart = tui.start;
  const guardedStop = tui.stop;
  tui.seedRenderState(["\x1b_Gf=100,i=91,r=1;QQ==\x1b\\"]);
  const writesBeforeStart = terminal.writes.length;
  const directWritesBeforeStart = terminal.directWrites.length;
  guardedStart();

  assert.equal(tui.startCallCount, 0);
  assert.equal(terminal.startCallCount, 0);
  assert.equal(terminal.writes.length, writesBeforeStart);
  assert.equal(terminal.directWrites.length, directWritesBeforeStart);
  assert.equal(tui.stopped, true);
  assert.deepEqual(tui.previousLines, []);
  assert.deepEqual([...tui.previousKittyImageIds], []);
  assert.equal(tui.previousWidth, -1);
  assert.equal(tui.previousHeight, -1);
  assert.equal(tui.cursorRow, 0);
  assert.equal(tui.hardwareCursorRow, 0);
  assert.equal(tui.maxLinesRendered, 0);
  assert.equal(tui.previousViewportTop, 0);

  guardedStop();
  assert.equal(terminal.writes.length, writesBeforeStart);
  assert.equal(terminal.stopCallCount, 1);
  assert.equal(tui.start, FakeTui.prototype.start);
  assert.equal(tui.stop, FakeTui.prototype.stop);
  assert.equal(Object.hasOwn(tui, "start"), false);
  assert.equal(Object.hasOwn(tui, "stop"), false);

  const directWritesAfterStop = terminal.directWrites.length;
  guardedStop();
  assert.equal(terminal.stopCallCount, 1);
  assert.equal(terminal.directWrites.length, directWritesAfterStop);
});

test("quit disposal invalidates stale render state after suspended cleanup without stopping twice", () => {
  const { terminal, tui, compositor } = installFixture();
  tui.stop();
  tui.seedRenderState(["stale-after-host-stop"]);
  const writesAfterStop = terminal.writes.length;
  const directWritesAfterStop = terminal.directWrites.length;

  compositor.dispose({ quiesceHost: true });

  assert.equal(compositor.disposed, true);
  assert.equal(tui.stopped, true);
  assert.deepEqual(tui.previousLines, []);
  assert.deepEqual([...tui.previousKittyImageIds], []);
  assert.equal(tui.previousWidth, -1);
  assert.equal(tui.previousHeight, -1);
  assert.equal(tui.cursorRow, 0);
  assert.equal(tui.hardwareCursorRow, 0);
  assert.equal(tui.maxLinesRendered, 0);
  assert.equal(tui.previousViewportTop, 0);
  assert.equal(terminal.writes.length, writesAfterStop);
  assert.equal(terminal.directWrites.length, directWritesAfterStop);
  assert.equal(terminal.stopCallCount, 1);
  assert.notEqual(tui.start, FakeTui.prototype.start);
  assert.notEqual(tui.stop, FakeTui.prototype.stop);
  assert.equal(Object.hasOwn(tui, "start"), true);
  assert.equal(Object.hasOwn(tui, "stop"), true);
});

test("quit guard restores exact host descriptors when original stop throws", () => {
  class ThrowingQuitStopTui extends FakeTui {
    override stop(): void {
      super.stop();
      throw new Error("quit host stop failed");
    }
  }

  const root = createFakeRoot();
  const terminal = new FakeTerminal();
  const tui = new ThrowingQuitStopTui(terminal, root.children);
  const originalStart = tui.start;
  const originalStop = tui.stop;
  tui.seedRenderState();
  const result = installFixedBottomCompositor({
    tui,
    semantics: publicSemantics(),
    processTarget: new FakeProcess(),
  });
  assert.equal(result.installed, true, result.installed ? undefined : result.reason);
  if (!result.installed) return;

  result.compositor.dispose({ quiesceHost: true });
  const guardedStop = tui.stop;

  assert.throws(() => guardedStop(), /quit host stop failed/);
  assert.equal(terminal.stopCallCount, 1);
  assert.equal(tui.start, originalStart);
  assert.equal(tui.stop, originalStop);
  assert.equal(Object.hasOwn(tui, "start"), false);
  assert.equal(Object.hasOwn(tui, "stop"), false);
  assert.deepEqual(tui.previousLines, []);
  assert.deepEqual([...tui.previousKittyImageIds], []);
  assert.equal(tui.previousWidth, -1);
  assert.equal(tui.previousHeight, -1);

  assert.doesNotThrow(() => guardedStop());
  assert.equal(terminal.stopCallCount, 1);
});

test("stop attempts original terminal shutdown and rethrows the first cleanup failure", () => {
  class ThrowingStopTui extends FakeTui {
    override stop(): void {
      super.stop();
      throw new Error("original stop failed");
    }
  }

  const root = createFakeRoot();
  const terminal = new FakeTerminal();
  const tui = new ThrowingStopTui(terminal, root.children);
  tui.seedRenderState();
  const result = installFixedBottomCompositor({
    tui,
    semantics: publicSemantics(),
    processTarget: new FakeProcess(),
  });
  assert.equal(result.installed, true, result.installed ? undefined : result.reason);
  if (!result.installed) return;
  terminal.failOnWriteAttempt = terminal.writeAttemptCount + 1;
  terminal.recordFailedWrite = true;

  assert.throws(() => tui.stop(), /terminal write failed/);
  const writesAfterStop = terminal.writes.length;
  const directWritesAfterStop = terminal.directWrites.length;
  assert.equal(terminal.stopCallCount, 1);

  assert.doesNotThrow(() => tui.stop());
  assert.equal(terminal.writes.length, writesAfterStop);
  assert.equal(terminal.directWrites.length, directWritesAfterStop);
  assert.equal(terminal.stopCallCount, 1);

  result.compositor.dispose();
  assert.equal(terminal.writes.length, writesAfterStop);
  assert.equal(terminal.directWrites.length, directWritesAfterStop);
  assert.equal(terminal.stopCallCount, 1);
});

test("terminal write failure still rolls back patches and hooks when no output is recorded", () => {
  const root = createFakeRoot();
  const terminal = new FakeTerminal();
  const tui = new FakeTui(terminal, root.children);
  const processTarget = new FakeProcess();
  const originalDoRender = tui.doRender;
  tui.seedRenderState(["initial-terminal-state"]);
  const initialState = tuiRenderState(tui);
  terminal.throwOnWrite = true;

  const result = installFixedBottomCompositor({
    tui,
    semantics: publicSemantics(),
    processTarget,
  });

  assert.equal(result.installed, false);
  assert.deepEqual(terminal.writes, []);
  assert.equal(tui.doRender, originalDoRender);
  assert.equal(tui.removeInputListenerCount, 1);
  assert.equal(processTarget.exitListenerCount(), 0);
  assert.equal(Object.hasOwn(terminal, "rows"), false);
  assert.equal(Object.hasOwn(terminal, "write"), false);
  assert.deepEqual(tuiRenderState(tui), initialState);
});

test("dispose is idempotent and restores descriptors, methods, listener, exit hook, and mode once", () => {
  const root = createFakeRoot();
  const terminal = new FakeTerminal();
  const tui = new FakeTui(terminal, root.children);
  const processTarget = new FakeProcess();
  const methods = {
    render: tui.render,
    doRender: tui.doRender,
    start: tui.start,
    stop: tui.stop,
    compositeOverlays: tui.compositeOverlays,
    compositeLineAt: tui.compositeLineAt,
    hideCursor: terminal.hideCursor,
    showCursor: terminal.showCursor,
  };
  const result = installFixedBottomCompositor({
    tui,
    semantics: publicSemantics(),
    processTarget,
  });
  assert.equal(result.installed, true);
  if (!result.installed) throw new Error(result.reason);
  assert.notEqual(tui.render, methods.render);
  assert.notEqual(tui.doRender, methods.doRender);
  assert.notEqual(tui.start, methods.start);
  assert.notEqual(tui.stop, methods.stop);
  assert.notEqual(tui.compositeOverlays, methods.compositeOverlays);
  assert.notEqual(tui.compositeLineAt, methods.compositeLineAt);
  assert.notEqual(terminal.hideCursor, methods.hideCursor);
  assert.notEqual(terminal.showCursor, methods.showCursor);
  assert.equal(Object.hasOwn(terminal, "rows"), true);
  assert.equal(Object.hasOwn(terminal, "write"), true);

  result.compositor.dispose();
  const writesAfterFirstDispose = terminal.writes.length;
  const restoreCount = terminal.writes.reduce(
    (count, output) => count + occurrences(output, "\x1b[?1049l"),
    0,
  );
  result.compositor.dispose();

  assert.equal(result.compositor.disposed, true);
  assert.equal(terminal.writes.length, writesAfterFirstDispose);
  assert.equal(restoreCount, 1);
  assert.equal(tui.removeInputListenerCount, 1);
  assert.equal(tui.inputListeners.size, 0);
  assert.equal(processTarget.exitListenerCount(), 0);
  assert.equal(tui.render, methods.render);
  assert.equal(tui.doRender, methods.doRender);
  assert.equal(tui.start, methods.start);
  assert.equal(tui.stop, methods.stop);
  assert.equal(tui.compositeOverlays, methods.compositeOverlays);
  assert.equal(tui.compositeLineAt, methods.compositeLineAt);
  assert.equal(terminal.hideCursor, methods.hideCursor);
  assert.equal(terminal.showCursor, methods.showCursor);
  assert.equal(Object.hasOwn(terminal, "rows"), false);
  assert.equal(Object.hasOwn(terminal, "write"), false);
  assert.equal(terminal.rows, 12);
  assertSafeWrites(terminal.writes);
});

test("process exit cleanup restores an entered mode exactly once", () => {
  const { terminal, tui, processTarget, compositor } = installFixture();

  processTarget.emit("exit");
  const writesAfterExit = terminal.writes.length;
  const restoreCount = terminal.writes.reduce(
    (count, output) => count + occurrences(output, "\x1b[?1049l"),
    0,
  );
  compositor.dispose();

  assert.equal(compositor.disposed, true);
  assert.equal(restoreCount, 1);
  assert.equal(terminal.writes.length, writesAfterExit);
  assert.equal(tui.inputListeners.size, 0);
  assert.equal(processTarget.exitListenerCount(), 0);
  assert.equal(Object.hasOwn(terminal, "rows"), false);
  assert.equal(Object.hasOwn(terminal, "write"), false);
  assertSafeWrites(terminal.writes);
});

test("faithful fixture emits Pi full clears and mutates render state when raw dimensions differ", () => {
  const root = createFakeRoot();
  const terminal = new FakeTerminal(40, 12);
  const tui = new FakeTui(terminal, root.children);
  tui.seedRenderState(["old-root"]);
  terminal.setSize(50, 10);

  tui.doRender();

  assert.ok(terminal.writes[0].includes("\x1b[2J\x1b[H\x1b[3J"));
  assert.equal(tui.previousWidth, 50);
  assert.equal(tui.previousHeight, 10);
  assert.equal(tui.previousLines.length, 18);
  assert.equal(tui.fullRedrawCount, 1);
});

test("install aligns every faithful Pi differential field before capture and writes no full clear", () => {
  const { terminal, tui, compositor } = installFixture();

  assert.equal(tui.previousWidth, 40);
  assert.equal(tui.previousHeight, 6);
  assert.equal(tui.previousViewportTop, 0);
  assert.equal(tui.maxLinesRendered, 6);
  assert.deepEqual(tui.previousLines, [
    "transcript-7",
    "transcript-8",
    "transcript-9",
    "transcript-10",
    "transcript-11",
    "transcript-12",
  ]);
  assertSafeWrites(terminal.writes);

  compositor.dispose();
});

test("raw grow and shrink reset every current physical row", () => {
  const { terminal, tui, compositor } = installFixture();

  terminal.setSize(40, 14);
  tui.doRender();
  const grown = terminal.writes.at(-1) ?? "";
  assertClearsRows(grown, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  assert.match(grown, /TUI\(rows=8\):/);

  terminal.setSize(40, 10);
  tui.doRender();
  const shrunk = terminal.writes.at(-1) ?? "";
  assertClearsRows(shrunk, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.match(shrunk, /TUI\(rows=4\):/);
  assertSafeWrites(terminal.writes);

  compositor.dispose();
});

test("widget and footer height changes clear both prior and replacement cluster geometry", () => {
  const { terminal, tui, root, compositor } = installFixture();

  root.widget.lines = ["widget-1", "widget-2", "widget-3"];
  tui.doRender();
  assertClearsRows(terminal.writes.at(-1) ?? "", [5, 6, 7, 8, 9, 10, 11, 12]);

  root.footer.lines = ["footer-1", "footer-2", "footer-3", ""];
  tui.doRender();
  assertClearsRows(terminal.writes.at(-1) ?? "", [3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

  root.widget.lines = [];
  root.footer.lines = ["footer", ""];
  tui.doRender();
  assertClearsRows(terminal.writes.at(-1) ?? "", [3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assertSafeWrites(terminal.writes);

  compositor.dispose();
});

test("overlay handoff clears every physical row across an unrendered resize", () => {
  const { terminal, tui, compositor } = installFixture();
  terminal.setSize(40, 14);

  tui.overlayVisible = true;
  tui.doRender();
  const opened = terminal.writes.at(-1) ?? "";
  assertClearsRows(opened, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  assert.match(opened, /TUI\(rows=14\):/);

  tui.overlayVisible = false;
  tui.doRender();
  const closed = terminal.writes.at(-1) ?? "";
  assertClearsRows(closed, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  assert.match(closed, /TUI\(rows=8\):/);
  assertSafeWrites(terminal.writes);

  compositor.dispose();
});

test("dispose clears old and current projected rows after a raw resize", () => {
  const { terminal, compositor } = installFixture();
  terminal.setSize(40, 14);

  compositor.dispose();

  const disposed = terminal.writes.at(-1) ?? "";
  assertClearsRows(disposed, [7, 8, 9, 10, 11, 12, 13, 14]);
  assertSafeWrites(terminal.writes);
});

test("install rejects captured Pi full clears before any physical write and restores render state", () => {
  const root = createFakeRoot();
  const terminal = new FakeTerminal();
  const tui = new FakeTui(terminal, root.children);
  const processTarget = new FakeProcess();
  tui.seedRenderState(["pre-install-root"]);
  tui.forceFullRedraw = true;
  const initialState = tuiRenderState(tui);

  const result = installFixedBottomCompositor({
    tui,
    semantics: publicSemantics(),
    processTarget,
  });

  assert.equal(result.installed, false);
  assert.match(result.installed ? "" : result.reason, /rejected Pi full redraw sequence/);
  assert.deepEqual(terminal.writes, []);
  assert.deepEqual(tuiRenderState(tui), initialState);
  assert.equal(tui.doRender, FakeTui.prototype.doRender);
  assert.equal(tui.inputListeners.size, 0);
  assert.equal(processTarget.exitListenerCount(), 0);
});

test("later captured Pi full clear fails closed without leaking the patched runtime", () => {
  const { terminal, tui, processTarget, compositor } = installFixture();
  const committedState = tuiRenderState(tui);
  tui.forceFullRedraw = true;

  assert.doesNotThrow(() => tui.doRender());

  assert.equal(compositor.disposed, true);
  assert.deepEqual(tuiRenderState(tui), committedState);
  assert.equal(tui.doRender, FakeTui.prototype.doRender);
  assert.equal(tui.inputListeners.size, 0);
  assert.equal(processTarget.exitListenerCount(), 0);
  assert.equal(Object.hasOwn(terminal, "rows"), false);
  assert.equal(Object.hasOwn(terminal, "write"), false);
  assertSafeWrites(terminal.writes);
});

test("later render exception fails closed and restores the committed TUI state", () => {
  const { terminal, tui, processTarget, compositor } = installFixture();
  const committedState = tuiRenderState(tui);
  tui.throwOnDoRender = true;

  assert.doesNotThrow(() => tui.doRender());

  assert.equal(compositor.disposed, true);
  assert.deepEqual(tuiRenderState(tui), committedState);
  assert.equal(tui.doRender, FakeTui.prototype.doRender);
  assert.equal(tui.inputListeners.size, 0);
  assert.equal(processTarget.exitListenerCount(), 0);
  assertSafeWrites(terminal.writes);
});

test("later physical write failure restores state and enters idempotent fail-closed disposal", () => {
  const { terminal, tui, root, processTarget, compositor } = installFixture();
  const committedState = tuiRenderState(tui);
  root.widget.lines = ["changed-widget"];
  terminal.failOnWriteAttempt = 2;
  terminal.recordFailedWrite = true;

  assert.doesNotThrow(() => tui.doRender());
  const writesAfterFailure = terminal.writes.length;
  compositor.dispose();

  assert.equal(compositor.disposed, true);
  assert.equal(terminal.writes.length, writesAfterFailure);
  assert.deepEqual(tuiRenderState(tui), committedState);
  assert.equal(tui.doRender, FakeTui.prototype.doRender);
  assert.equal(tui.inputListeners.size, 0);
  assert.equal(processTarget.exitListenerCount(), 0);
  assert.equal(Object.hasOwn(terminal, "rows"), false);
  assert.equal(Object.hasOwn(terminal, "write"), false);
  assertSafeWrites(terminal.writes);
});

test("disposal write failure restores the pre-disposal render state and removes every patch", () => {
  const { terminal, tui, processTarget, compositor } = installFixture();
  const committedState = tuiRenderState(tui);
  terminal.failOnWriteAttempt = 2;
  terminal.recordFailedWrite = true;

  assert.doesNotThrow(() => compositor.dispose());

  assert.equal(compositor.disposed, true);
  assert.deepEqual(tuiRenderState(tui), committedState);
  assert.equal(tui.doRender, FakeTui.prototype.doRender);
  assert.equal(tui.inputListeners.size, 0);
  assert.equal(processTarget.exitListenerCount(), 0);
  assert.equal(Object.hasOwn(terminal, "rows"), false);
  assert.equal(Object.hasOwn(terminal, "write"), false);
  const output = terminal.writes.join("");
  assert.equal(occurrences(output, "\x1b[?1006l"), 1);
  assert.equal(occurrences(output, "\x1b[?1002l"), 1);
  assert.equal(occurrences(output, "\x1b[?1000l"), 1);
  assert.equal(occurrences(output, "\x1b[?1049l"), 1);
  assertSafeWrites(terminal.writes);
});

test("quit quiescence survives disposal write failure and fail-closed cleanup", () => {
  const { terminal, tui, processTarget, compositor } = installFixture();
  terminal.failOnWriteAttempt = 2;
  terminal.recordFailedWrite = true;

  assert.doesNotThrow(() => compositor.dispose({ quiesceHost: true }));

  assert.equal(compositor.disposed, true);
  assert.equal(tui.stopped, true);
  assert.deepEqual(tui.previousLines, []);
  assert.deepEqual([...tui.previousKittyImageIds], []);
  assert.equal(tui.previousWidth, -1);
  assert.equal(tui.previousHeight, -1);
  assert.equal(tui.cursorRow, 0);
  assert.equal(tui.hardwareCursorRow, 0);
  assert.equal(tui.maxLinesRendered, 0);
  assert.equal(tui.previousViewportTop, 0);
  assert.equal(tui.doRender, FakeTui.prototype.doRender);
  assert.equal(tui.inputListeners.size, 0);
  assert.equal(processTarget.exitListenerCount(), 0);
  assert.equal(Object.hasOwn(terminal, "rows"), false);
  assert.equal(Object.hasOwn(terminal, "write"), false);
  assert.equal(occurrences(terminal.writes.join(""), "\x1b[?1049l"), 1);
});

test("all compositor writes avoid unpaired raw full-screen clear/home sequences", () => {
  const { terminal, tui, compositor } = installFixture();
  tui.doRender();
  compositor.dispose();

  assertSafeWrites(terminal.writes);
});
