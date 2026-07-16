import assert from "node:assert/strict";
import test from "node:test";
import {
  enterFixedBottomMode,
  FixedBottomTerminalModes,
  restoreTerminalModes,
  setScrollRegion,
  updateFixedBottomScrollRegion,
} from "../fixed-bottom/terminal-modes.ts";

test("builds deterministic terminal mode sequences", () => {
  assert.equal(setScrollRegion(1, 18), "\x1b[1;18r");
  assert.equal(
    enterFixedBottomMode(18),
    "\x1b[?2026h\x1b[?1049h\x1b[?1007l\x1b[1;18r\x1b[?2026l",
  );
  assert.equal(
    updateFixedBottomScrollRegion(16),
    "\x1b[?2026h\x1b[r\x1b[1;16r\x1b[?2026l",
  );
  assert.equal(
    restoreTerminalModes(),
    "\x1b[?2026h\x1b[r\x1b[?1007h\x1b[?1049l\x1b[?2026l",
  );
});

test("tracks enter, scroll-region updates, and restore idempotently", () => {
  const modes = new FixedBottomTerminalModes();

  assert.deepEqual(modes.snapshot(), { active: false, scrollBottom: null });
  assert.equal(modes.updateScrollRegion(18), "");
  assert.equal(modes.restore(), "");

  assert.equal(modes.enter(18), enterFixedBottomMode(18));
  assert.equal(modes.enter(18), "");
  assert.equal(modes.updateScrollRegion(18), "");
  assert.equal(modes.updateScrollRegion(16), updateFixedBottomScrollRegion(16));
  assert.deepEqual(modes.snapshot(), { active: true, scrollBottom: 16 });

  assert.equal(modes.restore(), restoreTerminalModes());
  assert.equal(modes.restore(), "");
  assert.deepEqual(modes.snapshot(), { active: false, scrollBottom: null });
});

test("rejects invalid scroll regions before changing state", () => {
  const modes = new FixedBottomTerminalModes();

  assert.throws(() => modes.enter(0), RangeError);
  assert.throws(() => setScrollRegion(4, 3), RangeError);
  assert.deepEqual(modes.snapshot(), { active: false, scrollBottom: null });
});
