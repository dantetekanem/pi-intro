import assert from "node:assert/strict";
import test from "node:test";
import { paintFixedBottomCluster } from "../fixed-bottom/paint.ts";

const PI_SEGMENT_RESET = "\x1b[0m\x1b]8;;\x07";

test("manual cluster painting closes SGR styles and OSC 8 hyperlinks at every line boundary", () => {
  const styled = "\x1b[31mred";
  const linked = "\x1b]8;;https://example.com\x07linked";

  const output = paintFixedBottomCluster({
    cluster: { lines: [styled, linked], cursor: null },
    terminalRows: 4,
    showHardwareCursor: false,
  });

  assert.ok(output.includes(`\x1b[3;1H\x1b[2K${styled}${PI_SEGMENT_RESET}`));
  assert.ok(output.includes(`\x1b[4;1H\x1b[2K${linked}${PI_SEGMENT_RESET}`));
  assert.ok(output.endsWith(`${PI_SEGMENT_RESET}\x1b[?25l`));
});

test("line resets follow complete Kitty APC payloads without corrupting their terminators", () => {
  const kitty = "\x1b_Gf=100,i=77,r=2;QUJDRA==\x1b\\";

  const output = paintFixedBottomCluster({
    cluster: { lines: [kitty], cursor: null },
    terminalRows: 4,
    showHardwareCursor: false,
  });

  assert.ok(output.includes(`\x1b[4;1H\x1b[2K${kitty}${PI_SEGMENT_RESET}\x1b[?25l`));
  assert.equal(output.includes(`QUJDRA==${PI_SEGMENT_RESET}\x1b\\`), false);
});
