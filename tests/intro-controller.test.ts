import assert from "node:assert/strict";
import test from "node:test";
import {
  FULL_SCREEN_OVERLAY_OPTIONS,
  playIntro,
  shouldAutoPlay,
  type IntroContext,
} from "../intro-controller.ts";

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};

test("auto-plays only for initial interactive startup", () => {
  assert.equal(shouldAutoPlay("startup", "tui"), true);

  for (const reason of ["reload", "new", "resume", "fork"]) {
    assert.equal(shouldAutoPlay(reason, "tui"), false);
  }

  for (const mode of ["rpc", "json", "print"]) {
    assert.equal(shouldAutoPlay("startup", mode), false);
  }
});

test("uses a full-screen overlay and restores Pi when any key is pressed", async () => {
  let receivedOptions: unknown;
  let doneCalls = 0;
  let renderRequests = 0;

  const context: IntroContext = {
    mode: "tui",
    ui: {
      async custom(factory, options) {
        receivedOptions = options;
        const component = factory(
          {
            terminal: { rows: 30 },
            requestRender: () => { renderRequests += 1; },
          },
          theme,
          {},
          () => { doneCalls += 1; },
        );
        component.handleInput("enter");
        component.dispose();
        return undefined;
      },
    },
  };

  assert.equal(await playIntro(context), true);
  assert.deepEqual(receivedOptions, FULL_SCREEN_OVERLAY_OPTIONS);
  assert.equal(FULL_SCREEN_OVERLAY_OPTIONS.overlay, true);
  assert.deepEqual(FULL_SCREEN_OVERLAY_OPTIONS.overlayOptions, {
    width: "100%",
    maxHeight: "100%",
    row: 0,
    col: 0,
    margin: 0,
  });
  assert.equal(doneCalls, 1);
  assert.equal(renderRequests, 1);
});

test("does not create terminal UI outside TUI mode", async () => {
  let customCalls = 0;
  const context: IntroContext = {
    mode: "print",
    ui: {
      async custom() {
        customCalls += 1;
        return undefined;
      },
    },
  };

  assert.equal(await playIntro(context), false);
  assert.equal(customCalls, 0);
});
