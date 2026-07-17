// Confirms the intro is fully gone after it finishes: real PiIntroComponent,
// real timers, real overlay host wiring (showOverlay/hideOverlay against a
// real TUI). After completion the overlay stack must be empty, every timer
// cleared, and the rendered output must contain no intro pixels.
import assert from "node:assert/strict";
import test from "node:test";
import { Container, TUI } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";
import { PiIntroComponent, INTRO_DURATION_MS } from "../intro-component.ts";
import { FULL_SCREEN_OVERLAY_OPTIONS } from "../intro-controller.ts";

class StubTerminal {
  readonly writes: string[] = [];
  readonly columns: number;
  readonly rows: number;
  constructor(columns: number, rows: number) {
    this.columns = columns;
    this.rows = rows;
  }
  start(_onInput: (data: string) => void, _onResize: () => void): void {}
  stop(): void {}
  async drainInput(): Promise<void> {}
  write(data: string): void {
    this.writes.push(data);
  }
  get kittyProtocolActive(): boolean {
    return false;
  }
  moveBy(): void {}
  hideCursor(): void {}
  showCursor(): void {}
  clearLine(): void {}
  clearFromCursor(): void {}
  clearScreen(): void {}
  setTitle(): void {}
  setProgress(): void {}
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};

test("intro overlay is gone after it finishes: stack empty, timers cleared, no intro pixels", async () => {
  const terminal = new StubTerminal(80, 14);
  const tui = new TUI(terminal as never);
  const chat = new Container();
  chat.addChild({ render: () => ["real content"], invalidate: () => {} });
  tui.addChild(chat);
  tui.start();
  await sleep(20);

  // Counting scheduler: real timers, just instrumented so we can assert none
  // are left running after the intro completes.
  let liveIntervals = 0;
  let liveTimeouts = 0;
  const scheduler = {
    now: () => Date.now(),
    setInterval: (cb: () => void, ms: number) => {
      liveIntervals++;
      return setInterval(cb, ms);
    },
    clearInterval: (h: unknown) => {
      liveIntervals--;
      clearInterval(h as ReturnType<typeof setInterval>);
    },
    setTimeout: (cb: () => void, ms: number) => {
      liveTimeouts++;
      return setTimeout(() => {
        liveTimeouts--;
        cb();
      }, ms);
    },
    clearTimeout: (h: unknown) => {
      liveTimeouts--;
      clearTimeout(h as ReturnType<typeof setTimeout>);
    },
  };

  // Mirror pi's showExtensionCustom overlay branch exactly.
  let component!: PiIntroComponent;
  const done = new Promise<void>((resolve) => {
    component = new PiIntroComponent({
      host: {
        get rows() {
          return tui.terminal.rows;
        },
        requestRender: () => tui.requestRender(),
      },
      theme,
      scheduler,
      onDone: () => {
        tui.hideOverlay();
        tui.requestRender();
        resolve();
      },
    });
  });
  component.start();
  tui.showOverlay(component as Component, FULL_SCREEN_OVERLAY_OPTIONS.overlayOptions as never);

  // While playing, the overlay is on the stack and its pixels composite on top.
  assert.equal(tui.overlayStack.length, 1, "intro overlay present while playing");

  // Wait out the full intro duration plus margin, then let the render loop run.
  await sleep(INTRO_DURATION_MS + 250);
  await done;
  await sleep(30);

  // 1. Overlay stack is empty — nothing of the intro remains mounted.
  assert.equal(tui.overlayStack.length, 0, "intro overlay removed from the stack");

  // 2. No intro pixels anywhere in the rendered frame.
  const output = tui.render(terminal.columns).join("\n");
  assert.equal(output.includes("██████"), false, "no logo blocks remain on screen");
  assert.equal(output.includes("INITIALIZING"), false);
  assert.equal(output.includes("PI · READY"), false);
  assert.ok(output.includes("real content"), "underlying UI is intact");

  // 3. Every intro timer was cleared (no lingering interval/timeout).
  assert.equal(liveIntervals, 0, "no animation interval left running");
  assert.equal(liveTimeouts, 0, "no transition/hold timeout left pending");

  // 4. The component no longer requests repaints and dispose is a no-op-safe.
  const writesBefore = terminal.writes.length;
  component.dispose();
  component.start(); // must not restart: finished is latched
  await sleep(60);
  assert.equal(tui.overlayStack.length, 0, "still no overlay after dispose/restart");
  assert.equal(liveIntervals, 0, "dispose/restart starts no timers");
  assert.equal(liveTimeouts, 0);
  assert.equal(terminal.writes.length, writesBefore, "no further repaints requested");
});
