import assert from "node:assert/strict";
import test from "node:test";
import {
  paintFixedBottomCluster,
  planFixedBottomClusterPaint,
} from "../fixed-bottom/paint.ts";

const PI_SEGMENT_RESET = "\x1b[0m\x1b]8;;\x07";

function occurrences(text: string, value: string): number {
  return text.split(value).length - 1;
}

test("ordinary text paint writes complete content before CSI 0K and closes Pi segments", () => {
  const styled = "\x1b[31mred";
  const linked = "\x1b]8;;https://example.com\x07linked";

  const output = paintFixedBottomCluster({
    cluster: { lines: [styled, linked], cursor: null },
    terminalRows: 4,
    force: true,
  });

  assert.ok(output.includes(`\x1b[3;1H${styled}${PI_SEGMENT_RESET}\x1b[0K`));
  assert.ok(output.includes(`\x1b[4;1H${linked}${PI_SEGMENT_RESET}\x1b[0K`));
  assert.ok(!output.includes(`\x1b[3;1H\x1b[2K${styled}`));
  assert.ok(!output.includes(`\x1b[4;1H\x1b[2K${linked}`));
});

test("ordinary differential compares serialized lines by absolute physical row", () => {
  const plan = planFixedBottomClusterPaint({
    cluster: { lines: ["same", "new", "same-bottom"], cursor: null },
    terminalRows: 6,
    previousLines: ["same", "old", "same-bottom"],
    previousTerminalRows: 6,
  });

  assert.equal(plan.deleteSequence, "");
  assert.equal(
    plan.paintSequence,
    `\x1b[5;1Hnew${PI_SEGMENT_RESET}\x1b[0K`,
  );
});

test("vacated physical rows use CUP plus CSI 2K", () => {
  const output = paintFixedBottomCluster({
    cluster: { lines: ["kept"], cursor: null },
    terminalRows: 4,
    previousLines: ["vacated", "kept"],
    previousTerminalRows: 4,
  });

  assert.ok(output.includes("\x1b[3;1H\x1b[2K"));
  assert.ok(!output.includes(`\x1b[4;1Hkept${PI_SEGMENT_RESET}`));
});

test("stable Kitty placement emits no delete, clear, APC, or text EL", () => {
  const kitty = "\x1b_Gf=100,i=77,r=2;QUJDRA==\x1b\\";
  const plan = planFixedBottomClusterPaint({
    cluster: { lines: [kitty, ""], cursor: null },
    terminalRows: 4,
    previousLines: [kitty, ""],
    previousTerminalRows: 4,
  });

  assert.equal(plan.deleteSequence, "");
  assert.equal(plan.paintSequence, "");
});

test("same-ID changed Kitty block deletes and clears before one complete APC repaint", () => {
  const previousKitty = "\x1b_Gf=100,i=77,r=2;QUJDRA==\x1b\\";
  const changedKitty = "\x1b_Gf=100,i=77,r=2;RUZHSA==\x1b\\";
  const delete77 = "\x1b_Ga=d,d=I,i=77,q=2\x1b\\";
  const plan = planFixedBottomClusterPaint({
    cluster: { lines: [changedKitty, ""], cursor: null },
    terminalRows: 4,
    previousLines: [previousKitty, ""],
    previousTerminalRows: 4,
  });
  const output = plan.deleteSequence + plan.paintSequence;

  assert.equal(plan.deleteSequence, delete77);
  assert.equal(occurrences(plan.paintSequence, changedKitty), 1);
  assert.ok(plan.paintSequence.startsWith("\x1b[3;1H\x1b[2K\x1b[4;1H\x1b[2K"));
  assert.ok(output.indexOf(delete77) < output.indexOf("\x1b[3;1H\x1b[2K"));
  assert.ok(output.indexOf("\x1b[4;1H\x1b[2K") < output.indexOf(changedKitty));
  assert.ok(!output.includes(`${changedKitty}${PI_SEGMENT_RESET}`));
  assert.ok(!output.includes(`${changedKitty}\x1b[0K`));
});
