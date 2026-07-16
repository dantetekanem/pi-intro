import assert from "node:assert/strict";
import test from "node:test";
import type { ViewportState } from "../fixed-bottom/contracts.ts";
import {
  createFixedBottomInputListener,
  fixedBottomScrollAction,
} from "../fixed-bottom/input.ts";
import {
  createViewportState,
  updateViewport,
} from "../fixed-bottom/viewport.ts";

test("maps PageUp/PageDown and common modified scroll keys only", () => {
  assert.equal(fixedBottomScrollAction("\x1b[5~"), "page-up");
  assert.equal(fixedBottomScrollAction("\x1b[6;2~"), "page-down");
  assert.equal(fixedBottomScrollAction("\x1b[1;5A"), "line-up");
  assert.equal(fixedBottomScrollAction("\x1b[1;5B"), "line-down");
  assert.equal(fixedBottomScrollAction("\x1b[1;5H"), "top");
  assert.equal(fixedBottomScrollAction("\x1b[1;5F"), "bottom");

  assert.equal(fixedBottomScrollAction("\x1b[A"), undefined);
  assert.equal(fixedBottomScrollAction("\x1b[1;2A"), undefined);
  assert.equal(fixedBottomScrollAction("\x1b[<64;20;10M"), undefined);
});

test("scroll listener updates the pure viewport and consumes recognized keys", () => {
  let state: ViewportState = updateViewport(createViewportState(), 20, 5).state;
  let renders = 0;
  let suspended = false;
  const listener = createFixedBottomInputListener({
    getState: () => state,
    setState: (next) => {
      state = next;
    },
    getVisibleRows: () => 5,
    isSuspended: () => suspended,
    requestRender: () => {
      renders += 1;
    },
  });

  assert.deepEqual(listener("\x1b[5~"), { consume: true });
  assert.equal(state.offset, 4);
  assert.deepEqual(listener("\x1b[1;5A"), { consume: true });
  assert.equal(state.offset, 5);
  assert.deepEqual(listener("\x1b[6~"), { consume: true });
  assert.equal(state.offset, 1);
  assert.deepEqual(listener("\x1b[1;5H"), { consume: true });
  assert.equal(state.offset, 15);
  assert.deepEqual(listener("\x1b[1;5F"), { consume: true });
  assert.equal(state.offset, 0);
  assert.equal(renders, 5);

  assert.equal(listener("\x1b[A"), undefined);
  assert.equal(listener("\x1b[<64;20;10M"), undefined);
  suspended = true;
  assert.equal(listener("\x1b[5~"), undefined);
  assert.equal(renders, 5);
});
