import assert from "node:assert/strict";
import test from "node:test";
import {
  CURSOR_MARKER,
  sliceByColumns,
  stripControlSequences,
  truncateToWidth,
  visibleWidth,
} from "../fixed-bottom/line-codec.ts";

test("measures graphemes while ignoring ANSI, OSC, APC, and the cursor marker", () => {
  const hyperlinkOpen = "\x1b]8;;https://example.com\x1b\\";
  const hyperlinkClose = "\x1b]8;;\x1b\\";
  const line = `\x1b[31mA界🙂e\u0301\t\x1b[0m${hyperlinkOpen}Z${hyperlinkClose}${CURSOR_MARKER}`;

  assert.equal(visibleWidth(line), 10);
  assert.equal(stripControlSequences(line), "A界🙂e\u0301\tZ");
});

test("slices only complete grapheme clusters", () => {
  const family = "👨‍👩‍👧‍👦";
  const line = `A${family}B`;

  assert.equal(sliceByColumns(line, 1, 1), "");
  assert.equal(sliceByColumns(line, 1, 2), family);
  assert.equal(sliceByColumns(line, 2, 1), "");
  assert.equal(sliceByColumns(line, 3, 1), "B");
});

test("keeps opaque image and control blocks atomic and byte-for-byte intact", () => {
  const kittyImage = "\x1b_Gf=100,a=T;QUJDRA==\x1b\\";
  const sixelImage = "\x1bPq~opaque-sixel-bytes\x1b\\";
  const oscImage = "\x1b]1337;File=inline=1:QUJDRA==\x07";
  const line = `A${kittyImage}${sixelImage}${oscImage}B`;

  assert.equal(visibleWidth(line), 2);
  assert.equal(stripControlSequences(line), "AB");
  assert.equal(sliceByColumns(line, 0, 1), `A${kittyImage}${sixelImage}${oscImage}`);
  assert.equal(sliceByColumns(line, 1, 1), `${kittyImage}${sixelImage}${oscImage}B`);
  assert.equal(truncateToWidth(line, 1), `A${kittyImage}${sixelImage}${oscImage}`);
});

test("truncation closes an active SGR style without splitting a wide grapheme", () => {
  assert.equal(truncateToWidth("\x1b[31mA界B\x1b[0m", 2), "\x1b[31mA\x1b[0m");
  assert.equal(visibleWidth(truncateToWidth("A界B", 3)), 3);
});
