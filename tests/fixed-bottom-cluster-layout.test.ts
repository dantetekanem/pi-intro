import assert from "node:assert/strict";
import test from "node:test";
import {
  CURSOR_MARKER,
  layoutFixedBottomCluster,
} from "../fixed-bottom/cluster-layout.ts";
import { visibleWidth } from "../fixed-bottom/line-codec.ts";

test("lays out fixed content in canonical display order", () => {
  const rendered = layoutFixedBottomCluster({
    width: 40,
    terminalRows: 10,
    status: { lines: ["status"] },
    aboveWidgets: [{ lines: ["above-a", "above-b"] }],
    editor: { lines: ["edit-a", `edit-${CURSOR_MARKER}b`] },
    belowWidgets: [{ lines: ["below"] }],
    footer: { lines: ["footer", ""] },
  });

  assert.deepEqual(rendered.lines, [
    "status",
    "above-a",
    "above-b",
    "edit-a",
    "edit-b",
    "below",
    "footer",
    "",
  ]);
  assert.deepEqual(rendered.cursor, { row: 4, col: 5 });
});

test("reserves one transcript row and crops the editor around its cursor", () => {
  const rendered = layoutFixedBottomCluster({
    width: 40,
    terminalRows: 4,
    status: { lines: ["status"] },
    editor: {
      lines: ["a", "b", "c", "d", `e${CURSOR_MARKER}`, "f", "g"],
    },
  });

  assert.deepEqual(rendered.lines, ["d", "e", "f"]);
  assert.deepEqual(rendered.cursor, { row: 1, col: 1 });
});

test("allocates editor, footer, status, then whole widgets in canonical display order", () => {
  const rendered = layoutFixedBottomCluster({
    width: 40,
    terminalRows: 8,
    status: { lines: ["status"] },
    aboveWidgets: [
      { lines: ["above-a", "above-b"] },
      { lines: ["too-large-a", "too-large-b", "too-large-c"] },
    ],
    editor: { lines: ["editor"] },
    belowWidgets: [{ lines: ["below"] }],
    footer: { lines: ["footer", ""] },
  });

  assert.deepEqual(rendered.lines, [
    "status",
    "above-a",
    "above-b",
    "editor",
    "below",
    "footer",
    "",
  ]);
  assert.ok(!rendered.lines.includes("too-large-a"));
});

test("preserves the footer ahead of status and widgets under row pressure", () => {
  const rendered = layoutFixedBottomCluster({
    width: 40,
    terminalRows: 4,
    status: { lines: ["status"] },
    aboveWidgets: [{ lines: ["above"] }],
    editor: { lines: ["editor"] },
    footer: { lines: ["footer", ""] },
  });

  assert.deepEqual(rendered.lines, ["editor", "footer", ""]);
});

test("crops a multiline editor before evicting a footer that can physically fit", () => {
  const rendered = layoutFixedBottomCluster({
    width: 40,
    terminalRows: 4,
    editor: { lines: ["edit-a", `edit-${CURSOR_MARKER}b`, "edit-c"] },
    footer: { lines: ["footer", ""] },
  });

  assert.deepEqual(rendered.lines, ["edit-b", "footer", ""]);
  assert.deepEqual(rendered.cursor, { row: 0, col: 5 });
});

test("never emits a footer trailing blank without its meaningful line", () => {
  const enoughRoom = layoutFixedBottomCluster({
    width: 40,
    terminalRows: 4,
    editor: { lines: ["editor"] },
    footer: { lines: ["", "footer", "", ""] },
  });
  const onlyOneRowFree = layoutFixedBottomCluster({
    width: 40,
    terminalRows: 3,
    editor: { lines: ["edit-a", "edit-b"] },
    footer: { lines: ["footer", ""] },
  });

  assert.deepEqual(enoughRoom.lines, ["editor", "footer", ""]);
  assert.deepEqual(onlyOneRowFree.lines, ["edit-a", "edit-b"]);
});

test("horizontally crops a long editor line around the cursor marker", () => {
  const rendered = layoutFixedBottomCluster({
    width: 5,
    terminalRows: 3,
    editor: { lines: [`012345${CURSOR_MARKER}6789`] },
  });

  assert.deepEqual(rendered.lines, ["45678"]);
  assert.deepEqual(rendered.cursor, { row: 0, col: 2 });
});

test("uses supplied public cursor and width semantics", () => {
  const publicWidth = (text: string): number => (
    [...text].reduce((width, character) => width + (character === "界" ? 3 : visibleWidth(character)), 0)
  );
  const rendered = layoutFixedBottomCluster({
    width: 20,
    terminalRows: 3,
    editor: { lines: [`A界${CURSOR_MARKER}B`] },
  }, {
    cursorMarker: CURSOR_MARKER,
    visibleWidth: publicWidth,
  });

  assert.deepEqual(rendered.lines, ["A界B"]);
  assert.deepEqual(rendered.cursor, { row: 0, col: 4 });
});
