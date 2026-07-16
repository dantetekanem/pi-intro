import assert from "node:assert/strict";
import test from "node:test";
import { installBottomSpacer } from "../bottom-spacer.ts";

interface TestComponent {
  children?: TestComponent[];
  render(width: number): string[];
}

function linesComponent(lines: string[]): TestComponent {
  return { render: () => lines };
}

function createHarness(
  rows: number,
  beforeStatus: string[],
  status: string[],
  afterStatus: string[],
) {
  let renderCalls = 0;
  let renderRequests = 0;
  const widgetContainer: TestComponent = {
    children: [],
    render(width) {
      return this.children!.flatMap((child) => child.render(width));
    },
  };
  const originalChildren = [
    linesComponent(beforeStatus),
    linesComponent(status),
    widgetContainer,
    linesComponent(afterStatus),
  ];
  const tui = {
    terminal: { rows },
    children: [...originalChildren],
    render(width: number): string[] {
      renderCalls += 1;
      return this.children.flatMap((child) => child.render(width));
    },
    requestRender() {
      renderRequests += 1;
    },
  };
  const originalRender = tui.render;
  const ui = {
    setWidget(_key: string, content: Function | undefined) {
      widgetContainer.children = content ? [content(tui, {})] : [];
    },
  };

  return {
    originalRender,
    tui,
    ui,
    get renderCalls() {
      return renderCalls;
    },
    get renderRequests() {
      return renderRequests;
    },
    get hasWidget() {
      return widgetContainer.children!.length > 0;
    },
    get rootChildCount() {
      return tui.children.length;
    },
    originalRootChildCount: originalChildren.length,
  };
}

test("short content gets blank lines before the status and editor cluster", () => {
  const harness = createHarness(
    8,
    ["transcript", "notice"],
    ["pi-emote", "status"],
    ["editor", "footer"],
  );
  const cleanup = installBottomSpacer(harness.ui as any);

  assert.ok(cleanup);
  const output = harness.tui.render(80);
  assert.deepEqual(output, [
    "transcript",
    "notice",
    "",
    "",
    "pi-emote",
    "status",
    "editor",
    "footer",
  ]);
  assert.equal(harness.renderCalls, 1);
  assert.equal(output.some((line) => line.includes("\0")), false);
});

test("full and overflowing content get no marker-derived padding", () => {
  for (const { rows, before, status, after } of [
    {
      rows: 6,
      before: ["chat", "notice"],
      status: ["pi-emote", "status"],
      after: ["editor", "footer"],
    },
    {
      rows: 4,
      before: ["one", "two", "three"],
      status: ["status"],
      after: ["editor", "footer"],
    },
  ]) {
    const harness = createHarness(rows, before, status, after);
    installBottomSpacer(harness.ui as any);

    const output = harness.tui.render(80);

    assert.deepEqual(output, [...before, ...status, ...after]);
    assert.equal(output.some((line) => line.includes("\0")), false);
  }
});

test("cleanup restores the original render and root children", () => {
  const harness = createHarness(6, ["chat"], ["status"], ["editor", "footer"]);
  const cleanup = installBottomSpacer(harness.ui as any);

  assert.ok(cleanup);
  assert.notEqual(harness.tui.render, harness.originalRender);
  assert.equal(harness.hasWidget, false);
  assert.equal(harness.rootChildCount, harness.originalRootChildCount + 1);
  assert.equal(harness.renderRequests, 1);

  cleanup();

  assert.equal(harness.tui.render, harness.originalRender);
  assert.equal(harness.rootChildCount, harness.originalRootChildCount);
  assert.equal(harness.renderRequests, 2);
});

test("cleanup does not overwrite a later render owner", () => {
  const harness = createHarness(6, ["chat"], ["status"], ["editor", "footer"]);
  const cleanup = installBottomSpacer(harness.ui as any);
  const laterRender = () => ["later owner"];

  assert.ok(cleanup);
  harness.tui.render = laterRender;
  cleanup();

  assert.equal(harness.tui.render, laterRender);
  assert.equal(harness.rootChildCount, harness.originalRootChildCount);
  assert.equal(harness.renderRequests, 2);
});

test("installer fails closed when setWidget does not expose the TUI synchronously", () => {
  const calls: Array<Function | undefined> = [];
  const ui = {
    setWidget(_key: string, content: Function | undefined) {
      calls.push(content);
    },
  };

  const cleanup = installBottomSpacer(ui as any);

  assert.equal(cleanup, undefined);
  assert.equal(typeof calls[0], "function");
  assert.equal(calls[1], undefined);
});

test("installer fails closed when the widget container is not in the root", () => {
  const originalRender = () => ["unchanged"];
  const tui = {
    terminal: { rows: 6 },
    children: [] as TestComponent[],
    render: originalRender,
    requestRender() {},
  };
  const calls: Array<Function | undefined> = [];
  const ui = {
    setWidget(_key: string, content: Function | undefined) {
      calls.push(content);
      if (content) content(tui, {});
    },
  };

  const cleanup = installBottomSpacer(ui as any);

  assert.equal(cleanup, undefined);
  assert.equal(tui.render, originalRender);
  assert.deepEqual(tui.children, []);
  assert.equal(calls[1], undefined);
});
