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

test("captures Escape through the TUI input path even if overlay focus moves", async () => {
  let receivedOptions: unknown;
  let doneCalls = 0;
  let renderRequests = 0;
  let listenerDisposals = 0;
  let inputListener: ((data: string) => { consume: true } | undefined) | undefined;

  const context: IntroContext = {
    mode: "tui",
    ui: {
      async custom(factory, options) {
        receivedOptions = options;
        const component = factory(
          {
            terminal: { rows: 30 },
            requestRender: () => { renderRequests += 1; },
            addInputListener(listener) {
              inputListener = listener;
              return () => { listenerDisposals += 1; };
            },
          },
          theme,
          {},
          () => { doneCalls += 1; },
        );

        assert.ok(inputListener);
        assert.equal(inputListener("x"), undefined);
        assert.equal(inputListener("\x1b[27;1:3u"), undefined);
        assert.equal(doneCalls, 0);
        assert.deepEqual(inputListener("\x1b"), { consume: true });
        assert.equal(doneCalls, 1);
        component.dispose();
        return undefined;
      },
    },
  };

  assert.equal(await playIntro(context), true);
  assert.deepEqual(receivedOptions, FULL_SCREEN_OVERLAY_OPTIONS);
  assert.equal(FULL_SCREEN_OVERLAY_OPTIONS.overlay, true);
  assert.deepEqual(FULL_SCREEN_OVERLAY_OPTIONS.overlayOptions, {
    nonCapturing: true,
    width: "100%",
    maxHeight: "100%",
    row: 0,
    col: 0,
    margin: 0,
  });
  assert.equal(doneCalls, 1);
  assert.equal(renderRequests, 1);
  assert.equal(listenerDisposals, 1);
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
