import assert from "node:assert/strict";
import test from "node:test";
import {
  CUSTOM_WORD_CHOICE,
  runIntroCommand,
  stylizeTagline,
  type IntroCommandUi,
} from "../intro-command.ts";
import { STYLE_PRESETS, type IntroStyle } from "../intro-component.ts";

interface ScriptedUi extends IntroCommandUi {
  calls: string[];
  notifications: Array<{ message: string; type?: string }>;
}

function scriptedUi(script: {
  selectChoice?: string;
  inputValue?: string;
  editorValue?: string;
}): ScriptedUi {
  const calls: string[] = [];
  const notifications: Array<{ message: string; type?: string }> = [];
  return {
    calls,
    notifications,
    async select(title, options) {
      calls.push(`select:${title}`);
      assert.ok(options.length >= 8, "7 presets + custom option");
      assert.equal(options.at(-1), CUSTOM_WORD_CHOICE);
      return script.selectChoice;
    },
    async input(title, placeholder) {
      calls.push(`input:${title}`);
      assert.ok(placeholder !== undefined && placeholder.length > 0, "word input is prefilled");
      return script.inputValue;
    },
    async editor(title, prefill) {
      calls.push(`editor:${title}`);
      assert.ok(prefill !== undefined && prefill.length > 0, "bottom message is prefilled");
      return script.editorValue;
    },
    notify(message, type) {
      notifications.push({ message, type });
    },
  };
}

const defaultStyle: IntroStyle = STYLE_PRESETS.shopify;

test("picking a preset applies it with the edited bottom message", async () => {
  const ui = scriptedUi({
    selectChoice: "HACKER MODE — #00dc41",
    editorValue: "welcome back",
  });
  let applied: IntroStyle | undefined;

  await runIntroCommand(ui, {
    currentStyle: defaultStyle,
    apply: async (style) => { applied = style; },
  });

  assert.deepEqual(ui.calls, ["select:PI intro style:", "editor:Bottom message (empty to hide):"]);
  assert.equal(applied?.word, "HACKER MODE");
  assert.equal(applied?.hex, "#00dc41");
  assert.equal(applied?.tagline, "W E L C O M E   B A C K");
  assert.equal(ui.notifications.length, 1);
  assert.ok(ui.notifications[0].message.includes("saved"));
});

test("preset keeps its tagline when the editor is confirmed unchanged", async () => {
  const ui = scriptedUi({
    selectChoice: "SHOPIFY — #95bf47",
    editorValue: "WELCOME BACK",
  });
  let applied: IntroStyle | undefined;

  await runIntroCommand(ui, {
    currentStyle: {},
    apply: async (style) => { applied = style; },
  });

  assert.equal(applied?.tagline, "W E L C O M E   B A C K");
});

test("empty editor value hides the bottom message", async () => {
  const ui = scriptedUi({
    selectChoice: "COFFEE TIME — #c08051",
    editorValue: "   ",
  });
  let applied: IntroStyle | undefined;

  await runIntroCommand(ui, {
    currentStyle: {},
    apply: async (style) => { applied = style; },
  });

  assert.equal(applied?.word, "COFFEE TIME");
  assert.equal(applied?.tagline, undefined);
});

test("custom word prompts for the big word and uppercases it", async () => {
  const ui = scriptedUi({
    selectChoice: CUSTOM_WORD_CHOICE,
    inputValue: "rooted",
    editorValue: "ACCESS GRANTED",
  });
  let applied: IntroStyle | undefined;

  await runIntroCommand(ui, {
    currentStyle: defaultStyle,
    apply: async (style) => { applied = style; },
  });

  assert.deepEqual(ui.calls, [
    "select:PI intro style:",
    "input:Big word (A–Z, space, apostrophe):",
    "editor:Bottom message (empty to hide):",
  ]);
  assert.equal(applied?.word, "ROOTED");
  assert.equal(applied?.hex, "#95bf47", "custom word keeps the current color");
  assert.equal(applied?.tagline, "A C C E S S   G R A N T E D");
});

test("cancelling any dialog leaves the intro unchanged", async () => {
  for (const script of [
    { selectChoice: undefined },
    { selectChoice: CUSTOM_WORD_CHOICE, inputValue: undefined },
    { selectChoice: "PI — default (theme accent)", editorValue: undefined },
  ]) {
    const ui = scriptedUi(script);
    let applyCalls = 0;

    await runIntroCommand(ui, {
      currentStyle: defaultStyle,
      apply: async () => { applyCalls += 1; },
    });

    assert.equal(applyCalls, 0, `no apply for ${JSON.stringify(script)}`);
  }
});

test("empty custom word warns and applies nothing", async () => {
  const ui = scriptedUi({
    selectChoice: CUSTOM_WORD_CHOICE,
    inputValue: "   ",
  });
  let applyCalls = 0;

  await runIntroCommand(ui, {
    currentStyle: defaultStyle,
    apply: async () => { applyCalls += 1; },
  });

  assert.equal(applyCalls, 0);
  assert.equal(ui.notifications[0]?.type, "warning");
});

test("stylizeTagline normalizes and re-spaces text", () => {
  assert.equal(stylizeTagline("welcome back"), "W E L C O M E   B A C K");
  assert.equal(stylizeTagline("  bom    dia  "), "B O M   D I A");
  assert.equal(stylizeTagline("   "), "");
  assert.equal(stylizeTagline("W E L C O M E   B A C K"), "W E L C O M E   B A C K");
});
