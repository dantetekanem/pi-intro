import assert from "node:assert/strict";
import test from "node:test";
import { installFixedBottomCompositor } from "../fixed-bottom/compositor.ts";
import {
  preflightFixedBottomCompositor,
  SUPPORTED_PI_VERSION,
} from "../fixed-bottom/compatibility.ts";
import {
  createFakeRoot,
  FakeProcess,
  FakeRenderable,
  FakeTerminal,
  FakeTui,
  publicSemantics,
} from "./fixtures/fixed-bottom-fakes.ts";

function fixture(): {
  terminal: FakeTerminal;
  tui: FakeTui;
  processTarget: FakeProcess;
} {
  const terminal = new FakeTerminal();
  const tui = new FakeTui(terminal, createFakeRoot().children);
  return { terminal, tui, processTarget: new FakeProcess() };
}

test("accepts only the exact verified Pi 0.80.7 private shape", () => {
  const { tui } = fixture();
  const result = preflightFixedBottomCompositor({
    tui,
    runtimeVersion: SUPPORTED_PI_VERSION,
    semantics: publicSemantics(),
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.compatibility.rootChildren.length, 9);
    assert.equal(typeof result.compatibility.terminalRowsDescriptor.get, "function");
  }
});

test("every preflight mismatch fails with zero writes, listeners, or runtime patches", () => {
  const cases: Array<(terminal: FakeTerminal, tui: FakeTui) => {
    runtimeVersion?: string;
    semantics?: ReturnType<typeof publicSemantics>;
  }> = [
    () => ({ runtimeVersion: "0.80.6" }),
    (terminal) => {
      terminal.setSize(40, Number.NaN);
      return {};
    },
    (terminal) => {
      Object.defineProperty(terminal, "rows", {
        configurable: true,
        enumerable: true,
        writable: true,
        value: 12,
      });
      return {};
    },
    (_terminal, tui) => {
      tui.children.pop();
      return {};
    },
    (_terminal, tui) => {
      tui.children[8] = {} as FakeRenderable;
      return {};
    },
    () => ({ semantics: { ...publicSemantics(), cursorMarker: "wrong" } }),
  ];

  for (const mutate of cases) {
    const { terminal, tui, processTarget } = fixture();
    const overrides = mutate(terminal, tui);
    const methods = {
      render: tui.render,
      doRender: tui.doRender,
      compositeLineAt: tui.compositeLineAt,
    };
    const rowsOwn = Object.getOwnPropertyDescriptor(terminal, "rows");
    const writeOwn = Object.getOwnPropertyDescriptor(terminal, "write");

    const result = installFixedBottomCompositor({
      tui,
      runtimeVersion: overrides.runtimeVersion ?? SUPPORTED_PI_VERSION,
      semantics: overrides.semantics ?? publicSemantics(),
      processTarget,
    });

    assert.equal(result.installed, false);
    assert.deepEqual(terminal.writes, []);
    assert.equal(tui.addInputListenerCount, 0);
    assert.equal(tui.inputListeners.size, 0);
    assert.equal(processTarget.exitListenerCount(), 0);
    assert.equal(tui.render, methods.render);
    assert.equal(tui.doRender, methods.doRender);
    assert.equal(tui.compositeLineAt, methods.compositeLineAt);
    assert.deepEqual(Object.getOwnPropertyDescriptor(terminal, "rows"), rowsOwn);
    assert.deepEqual(Object.getOwnPropertyDescriptor(terminal, "write"), writeOwn);
  }
});
