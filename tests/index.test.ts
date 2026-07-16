import assert from "node:assert/strict";
import test from "node:test";
import piIntroExtension from "../index.ts";

interface RegisteredHandlers {
  readonly events: Map<string, Function>;
  command?: { description: string; handler: Function };
}

function register(options: {
  playIntro?: (context: any) => Promise<boolean>;
  installBottomSpacer?: (ui: any) => (() => void) | undefined;
} = {}): RegisteredHandlers {
  const registered: RegisteredHandlers = { events: new Map() };
  const pi = {
    on(event: string, handler: Function) {
      registered.events.set(event, handler);
    },
    registerCommand(name: string, command: { description: string; handler: Function }) {
      assert.equal(name, "intro");
      registered.command = command;
    },
  };

  piIntroExtension(
    pi as any,
    options.playIntro ?? (async () => true),
    options.installBottomSpacer ?? (() => undefined),
  );
  return registered;
}

test("registers only session lifecycle and /intro", () => {
  const registered = register();

  assert.deepEqual([...registered.events.keys()], ["session_start", "session_shutdown"]);
  assert.equal(registered.command?.description, "Replay the PI startup introduction");
});

test("session_start stays nonblocking and installs after the startup intro", async () => {
  let finishIntro!: (played: boolean) => void;
  const intro = new Promise<boolean>((resolve) => {
    finishIntro = resolve;
  });
  const calls: string[] = [];
  let installedUi: unknown;
  let installationFinished!: () => void;
  const installed = new Promise<void>((resolve) => {
    installationFinished = resolve;
  });
  const registered = register({
    playIntro: async () => {
      calls.push("intro");
      return intro;
    },
    installBottomSpacer: (ui) => {
      calls.push("spacer");
      installedUi = ui;
      installationFinished();
      return () => {};
    },
  });
  const ui = {};

  const result = registered.events.get("session_start")!(
    { reason: "startup" },
    { mode: "tui", ui },
  );

  assert.equal(result, undefined);
  assert.deepEqual(calls, ["intro"]);

  finishIntro(true);
  await installed;

  assert.deepEqual(calls, ["intro", "spacer"]);
  assert.equal(installedUi, ui);
});

test("stale startup intro completion does not install a spacer", async () => {
  let finishIntro!: (played: boolean) => void;
  const intro = new Promise<boolean>((resolve) => {
    finishIntro = resolve;
  });
  let installs = 0;
  const registered = register({
    playIntro: () => intro,
    installBottomSpacer: () => {
      installs += 1;
      return () => {};
    },
  });

  registered.events.get("session_start")!(
    { reason: "startup" },
    { mode: "tui", ui: {} },
  );
  registered.events.get("session_shutdown")!({ reason: "quit" }, { mode: "tui" });

  finishIntro(true);
  await intro;
  await Promise.resolve();

  assert.equal(installs, 0);
});

test("shutdown removes the installed spacer and clears it", () => {
  let installs = 0;
  let cleanups = 0;
  const registered = register({
    installBottomSpacer: () => {
      installs += 1;
      return () => {
        cleanups += 1;
      };
    },
  });

  registered.events.get("session_start")!(
    { reason: "resume" },
    { mode: "tui", ui: {} },
  );
  registered.events.get("session_shutdown")!({ reason: "resume" }, { mode: "tui" });
  registered.events.get("session_shutdown")!({ reason: "quit" }, { mode: "tui" });

  assert.equal(installs, 1);
  assert.equal(cleanups, 1);
});

test("does not install outside TUI mode", async () => {
  let installs = 0;
  const registered = register({
    installBottomSpacer: () => {
      installs += 1;
      return () => {};
    },
  });

  registered.events.get("session_start")!(
    { reason: "resume" },
    { mode: "print", ui: {} },
  );
  await Promise.resolve();

  assert.equal(installs, 0);
});

test("keeps /intro and waits for the replay", async () => {
  const contexts: unknown[] = [];
  let finishReplay!: (played: boolean) => void;
  const replay = new Promise<boolean>((resolve) => {
    finishReplay = resolve;
  });
  const registered = register({
    playIntro: (context) => {
      contexts.push(context);
      return replay;
    },
  });
  const context = { mode: "tui", ui: {} };
  let finished = false;

  const result = registered.command!.handler("", context).then(() => {
    finished = true;
  });
  await Promise.resolve();

  assert.equal(finished, false);
  assert.deepEqual(contexts, [context]);

  finishReplay(true);
  await result;
  assert.equal(finished, true);
});
