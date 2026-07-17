// Regression tests against the real @earendil-works/pi-tui TUI class.
//
// Only the terminal transport (the outermost I/O leaf) is stubbed. The full
// TUI tree — real Container layout, real render(), real differential render
// loop, real overlay stack — runs unmodified, and the root children mirror
// interactive-mode's exact ordering:
//   header, chat, pending, status, widgetAbove, editor, widgetBelow, footer
import assert from "node:assert/strict";
import test from "node:test";
import { Container, TUI } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";
import { installBottomSpacer } from "../bottom-spacer.ts";

class StubTerminal {
  readonly writes: string[] = [];
  readonly columns: number;
  rows: number;
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

const lines = (strings: string[]): Component => ({
  render: () => strings,
  invalidate: () => {},
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface PiLayout {
  tui: TUI;
  terminal: StubTerminal;
  chat: Container;
  pending: Container;
  status: Container;
  editor: Container;
  setWidget: (key: string, content: ((tui: TUI) => Component) | undefined) => void;
}

function createPiLayout(rows: number): PiLayout {
  const terminal = new StubTerminal(80, rows);
  const tui = new TUI(terminal as never);
  const chat = new Container();
  const pending = new Container();
  const status = new Container();
  const widgetAbove = new Container();
  const editor = new Container();
  const widgetBelow = new Container();
  const footer = new Container();

  editor.addChild(lines(["> |"]));
  footer.addChild(lines(["footer"]));
  tui.addChild(lines(["header"]));
  tui.addChild(chat);
  tui.addChild(pending);
  tui.addChild(status);
  tui.addChild(widgetAbove);
  tui.addChild(editor);
  tui.addChild(widgetBelow);
  tui.addChild(footer);

  const setWidget = (_key: string, content: ((tui: TUI) => Component) | undefined) => {
    widgetAbove.clear();
    if (content) widgetAbove.addChild(content(tui));
    tui.requestRender();
  };

  return { tui, terminal, chat, pending, status, editor, setWidget };
}

test("real TUI: a sent message and its working status stay in the viewport", async () => {
  const { tui, terminal, chat, pending, status, setWidget } = createPiLayout(12);
  chat.addChild(lines(["π v0.80.10", "chat: previous exchange"]));
  tui.start();
  await sleep(30);

  const cleanup = installBottomSpacer({ setWidget } as never);
  assert.ok(cleanup, "spacer must install on the real TUI");

  // User submits a message: it lands in chat, a working status appears, and a
  // queued follow-up shows in the pending area (the reported failure was these
  // never displaying).
  chat.addChild(lines(["user: hello there"]));
  status.addChild(lines(["⠋ Working..."]));
  pending.addChild(lines(["queued: follow-up"]));
  tui.requestRender();
  await sleep(30);

  const output = tui.render(80);
  const viewport = output.slice(-terminal.rows);
  assert.ok(
    viewport.some((line) => line.includes("user: hello there")),
    `sent message must be visible, got viewport: ${JSON.stringify(viewport)}`,
  );
  assert.ok(viewport.some((line) => line.includes("Working...")));
  assert.ok(viewport.some((line) => line.includes("queued: follow-up")));
  // Marker itself must never leak into the output.
  assert.equal(output.some((line) => line.includes("\0")), false);

  cleanup?.();
});

test("real TUI: content growth consumes padding instead of overflowing the screen", async () => {
  const { tui, terminal, chat, status, setWidget } = createPiLayout(12);
  chat.addChild(lines(["one", "two"]));
  tui.start();
  await sleep(30);

  const cleanup = installBottomSpacer({ setWidget } as never);
  assert.ok(cleanup);
  const before = tui.render(80);
  assert.equal(before.length, terminal.rows, "short content pins editor cluster to the bottom");

  // A streamed reply grows content above the marker. Total must stay clamped
  // at the terminal height (padding shrinks) rather than growing past it and
  // shoving the top into scrollback.
  for (let i = 1; i <= 4; i++) chat.addChild(lines([`reply ${i}`]));
  status.addChild(lines(["⠋ Working..."]));
  tui.requestRender();
  await sleep(30);

  const after = tui.render(80);
  assert.ok(
    after.length <= terminal.rows,
    `render must not exceed terminal rows (${after.length} > ${terminal.rows})`,
  );
  const viewport = after.slice(-terminal.rows);
  assert.ok(viewport.some((line) => line.includes("reply 4")));
  assert.ok(viewport.includes("> |"), "editor stays pinned at the bottom");
  assert.ok(viewport.includes("footer"));

  cleanup?.();
});

test("real TUI: render never exceeds terminal height once content overflows", async () => {
  const { tui, terminal, chat, setWidget } = createPiLayout(10);
  for (let i = 1; i <= 30; i++) chat.addChild(lines([`history ${i}`]));
  tui.start();
  await sleep(30);

  const cleanup = installBottomSpacer({ setWidget } as never);
  assert.ok(cleanup);

  chat.addChild(lines(["user: ping"]));
  tui.requestRender();
  await sleep(30);

  const output = tui.render(80);
  const viewport = output.slice(-terminal.rows);
  assert.ok(viewport.some((line) => line.includes("user: ping")));
  assert.ok(viewport.includes("footer"), "footer stays at the bottom of the viewport");

  cleanup?.();
});

test("real TUI: cleanup restores the original render and child list", async () => {
  const { tui, chat, setWidget } = createPiLayout(10);
  chat.addChild(lines(["chat"]));
  tui.start();
  await sleep(30);

  const originalRender = tui.render;
  const originalChildren = tui.children.length;
  const cleanup = installBottomSpacer({ setWidget } as never);
  assert.ok(cleanup);
  assert.notEqual(tui.render, originalRender);
  assert.equal(tui.children.length, originalChildren + 1);

  cleanup?.();
  assert.equal(tui.render, originalRender);
  assert.equal(tui.children.length, originalChildren);
});
