import assert from "node:assert/strict";
import test from "node:test";
import {
  createViewportState,
  followViewportBottom,
  scrollViewport,
  sliceViewport,
  updateViewport,
} from "../fixed-bottom/viewport.ts";

test("follows the bottom while the transcript grows", () => {
  let result = updateViewport(createViewportState(), 5, 3);
  assert.deepEqual(result.window, { start: 2, end: 5, offset: 0, maxOffset: 2 });

  result = updateViewport(result.state, 7, 3);
  assert.deepEqual(result.window, { start: 4, end: 7, offset: 0, maxOffset: 4 });
  assert.deepEqual(sliceViewport(["a", "b", "c", "d", "e", "f", "g"], result.window), ["e", "f", "g"]);
});

test("preserves the visible transcript anchor when lines append while scrolled up", () => {
  let result = updateViewport(createViewportState(), 5, 3);
  result = scrollViewport(result.state, 2, 3);
  assert.equal(result.window.start, 0);

  result = updateViewport(result.state, 7, 3);
  assert.deepEqual(result.window, { start: 0, end: 3, offset: 4, maxOffset: 4 });
});

test("clamps offsets after resize and transcript shrink", () => {
  let result = updateViewport(createViewportState(), 10, 4);
  result = scrollViewport(result.state, 5, 4);
  assert.equal(result.state.offset, 5);

  result = updateViewport(result.state, 10, 8);
  assert.deepEqual(result.window, { start: 0, end: 8, offset: 2, maxOffset: 2 });

  result = updateViewport(result.state, 3, 2);
  assert.deepEqual(result.window, { start: 0, end: 2, offset: 1, maxOffset: 1 });
});

test("can explicitly return to bottom following", () => {
  let result = updateViewport(createViewportState(), 8, 3);
  result = scrollViewport(result.state, 3, 3);
  result = followViewportBottom(result.state, 3);

  assert.deepEqual(result.window, { start: 5, end: 8, offset: 0, maxOffset: 5 });
});
