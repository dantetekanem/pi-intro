import assert from "node:assert/strict";
import test from "node:test";
import piIntroExtension from "../index.ts";

interface RegisteredHandlers {
  readonly events: Map<string, Function>;
  command?: { description: string; handler: Function };
}

function register(runtime?: object): RegisteredHandlers {
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

  if (runtime) piIntroExtension(pi as any, runtime as any);
  else piIntroExtension(pi as any);
  return registered;
}

test("thin index registers only session lifecycle, input bottom-follow, and /intro", () => {
  const registered = register({
    async start() {},
    shutdown() {},
    input() {},
    async replayIntro() {},
  });

  assert.deepEqual(
    [...registered.events.keys()],
    ["session_start", "session_shutdown", "input"],
  );
  assert.equal(registered.command?.description, "Replay the PI startup introduction");
});

test("registered handlers delegate to one session runtime without transforming input", async () => {
  const calls: Array<[string, ...unknown[]]> = [];
  const runtime = {
    async start(event: unknown, context: unknown) {
      calls.push(["start", event, context]);
    },
    shutdown() {
      calls.push(["shutdown"]);
    },
    input() {
      calls.push(["input"]);
      return undefined;
    },
    async replayIntro(context: unknown) {
      calls.push(["replay", context]);
      return true;
    },
  };
  const registered = register(runtime);
  const startEvent = { reason: "startup" };
  const startContext = { mode: "tui" };
  const commandContext = { mode: "tui" };

  await registered.events.get("session_start")!(startEvent, startContext);
  const inputResult = await registered.events.get("input")!({ text: "hello" }, startContext);
  await registered.command!.handler("", commandContext);
  await registered.events.get("session_shutdown")!({ reason: "quit" }, startContext);

  assert.equal(inputResult, undefined);
  assert.deepEqual(calls, [
    ["start", startEvent, startContext],
    ["input"],
    ["replay", commandContext],
    ["shutdown"],
  ]);
});

test("default registration does not load Pi/TUI runtime modules", () => {
  const registered = register();

  assert.equal(registered.events.size, 3);
  assert.ok(registered.command);
});
