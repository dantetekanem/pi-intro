import assert from "node:assert/strict";
import test from "node:test";
import { SUPPORTED_PI_VERSION } from "../fixed-bottom/compatibility.ts";
import type {
  FixedBottomCompositor,
  FixedBottomDisposeOptions,
} from "../fixed-bottom/compositor.ts";
import { CURSOR_MARKER } from "../fixed-bottom/contracts.ts";
import {
  loadFixedBottomPlatform,
  PI_CODING_AGENT_MODULE,
  PI_TUI_MODULE,
  type FixedBottomPlatform,
} from "../fixed-bottom/platform.ts";
import {
  FixedBottomSessionRuntime,
  type FixedBottomSessionContext,
} from "../fixed-bottom/session-runtime.ts";

function platform(runtimeVersion = SUPPORTED_PI_VERSION): FixedBottomPlatform {
  return {
    runtimeVersion,
    semantics: {
      cursorMarker: CURSOR_MARKER,
      visibleWidth: (text) => text.replaceAll(CURSOR_MARKER, "").length,
    },
    deleteKittyImage: (imageId) => `delete:${imageId}`,
  };
}

class FakeCompositor implements FixedBottomCompositor {
  disposed = false;
  jumpCalls = 0;
  repaintCalls = 0;
  disposeCalls = 0;
  readonly disposeOptions: Array<FixedBottomDisposeOptions | undefined> = [];
  readonly order?: string[];

  constructor(order?: string[]) {
    this.order = order;
  }

  jumpToBottom(): void {
    this.jumpCalls += 1;
    this.order?.push("bottom");
  }

  requestRepaint(): void {
    this.repaintCalls += 1;
    this.order?.push("repaint");
  }

  dispose(options?: FixedBottomDisposeOptions): void {
    if (this.disposed) return;
    this.disposed = true;
    this.disposeCalls += 1;
    this.disposeOptions.push(options);
    this.order?.push("dispose");
  }
}

interface ContextState {
  readonly widgetCalls: Array<{
    key: string;
    content: Function | undefined;
  }>;
  readonly bootstrapComponents: Array<{
    render(width: number): string[];
    invalidate(): void;
  }>;
  readonly notifications: Array<[string, string]>;
  readonly activeWidgets: Map<string, Function>;
  footerCalls: number;
  editorCalls: number;
}

function createContext(
  mode = "tui",
  tui: object = { id: "tui" },
  order?: string[],
): { context: FixedBottomSessionContext; state: ContextState } {
  const state: ContextState = {
    widgetCalls: [],
    bootstrapComponents: [],
    notifications: [],
    activeWidgets: new Map(),
    footerCalls: 0,
    editorCalls: 0,
  };

  const context = {
    mode,
    ui: {
      async custom() {
        return undefined;
      },
      setWidget(key: string, content: Function | undefined) {
        state.widgetCalls.push({ key, content });
        if (!content) {
          state.activeWidgets.delete(key);
          order?.push("widget:remove");
          return;
        }

        state.activeWidgets.set(key, content);
        order?.push("widget:add");
        const component = content(tui, {});
        state.bootstrapComponents.push(component);
      },
      setFooter() {
        state.footerCalls += 1;
      },
      setEditorComponent() {
        state.editorCalls += 1;
      },
      notify(message: string, level: string) {
        state.notifications.push([message, level]);
      },
    },
  };

  return { context: context as unknown as FixedBottomSessionContext, state };
}

test("loads exact public Pi/TUI platform values without static runtime imports", async () => {
  const imports: string[] = [];
  const publicWidth = (text: string) => text.length;
  const publicDelete = (imageId: number) => `kitty:${imageId}`;

  const result = await loadFixedBottomPlatform(async (specifier) => {
    imports.push(specifier);
    if (specifier === PI_CODING_AGENT_MODULE) {
      return { VERSION: "0.80.7-exact" };
    }
    return {
      CURSOR_MARKER: "official-marker",
      visibleWidth: publicWidth,
      deleteKittyImage: publicDelete,
    };
  });

  assert.deepEqual(imports, [PI_CODING_AGENT_MODULE, PI_TUI_MODULE]);
  assert.equal(result.runtimeVersion, "0.80.7-exact");
  assert.equal(result.semantics.cursorMarker, "official-marker");
  assert.equal(result.semantics.visibleWidth, publicWidth);
  assert.equal(result.deleteKittyImage?.(42), "kitty:42");

  const incompatibleDelete = await loadFixedBottomPlatform(async (specifier) => (
    specifier === PI_CODING_AGENT_MODULE
      ? { VERSION: SUPPORTED_PI_VERSION }
      : {
          CURSOR_MARKER,
          visibleWidth: publicWidth,
          deleteKittyImage: (_imageId: number, _extra: unknown) => "wrong signature",
        }
  ));
  assert.equal(incompatibleDelete.deleteKittyImage, undefined);
});

test("awaits the startup intro before loading and installing fixed-bottom mode", async () => {
  const order: string[] = [];
  const tui = { id: "captured-tui" };
  const { context, state } = createContext("tui", tui, order);
  const compositor = new FakeCompositor();
  let installedTui: unknown;

  const runtime = new FixedBottomSessionRuntime({
    playIntro: async () => {
      order.push("intro:start");
      await Promise.resolve();
      order.push("intro:end");
      return true;
    },
    loadPlatform: async () => {
      order.push("platform");
      return platform();
    },
    installCompositor: (options) => {
      order.push("install");
      installedTui = options.tui;
      return { installed: true, compositor };
    },
  });

  await runtime.start({ reason: "startup" }, context);

  assert.deepEqual(order, [
    "intro:start",
    "intro:end",
    "platform",
    "widget:add",
    "widget:remove",
    "install",
  ]);
  assert.equal(installedTui, tui);
  assert.equal(state.activeWidgets.size, 0);
  assert.equal(state.bootstrapComponents.length, 1);
  assert.deepEqual(state.bootstrapComponents[0].render(80), []);
  assert.doesNotThrow(() => state.bootstrapComponents[0].invalidate());
});

test("installs without autoplay for reload, new, resume, and fork", async () => {
  for (const reason of ["reload", "new", "resume", "fork"]) {
    const { context } = createContext();
    let introCalls = 0;
    let installCalls = 0;
    const runtime = new FixedBottomSessionRuntime({
      playIntro: async () => {
        introCalls += 1;
        return true;
      },
      loadPlatform: async () => platform(),
      installCompositor: () => {
        installCalls += 1;
        return { installed: true, compositor: new FakeCompositor() };
      },
    });

    await runtime.start({ reason }, context);
    assert.equal(introCalls, 0, reason);
    assert.equal(installCalls, 1, reason);
    runtime.shutdown({ reason: "reload" });
  }
});

test("captures TUI with unique temporary zero-line widgets and never replaces footer or editor", async () => {
  const first = createContext("tui", { id: "first" });
  const second = createContext("tui", { id: "second" });
  const installedTuis: unknown[] = [];

  for (const fixture of [first, second]) {
    const runtime = new FixedBottomSessionRuntime({
      loadPlatform: async () => platform(),
      installCompositor: (options) => {
        installedTuis.push(options.tui);
        return { installed: true, compositor: new FakeCompositor() };
      },
    });
    await runtime.start({ reason: "reload" }, fixture.context);
  }

  const firstKey = first.state.widgetCalls[0].key;
  const secondKey = second.state.widgetCalls[0].key;
  assert.match(firstKey, /^pi-intro\.fixed-bottom\.bootstrap\.\d+$/);
  assert.notEqual(firstKey, secondKey);
  assert.deepEqual(
    first.state.widgetCalls.map((call) => [call.key, typeof call.content]),
    [[firstKey, "function"], [firstKey, "undefined"]],
  );
  assert.deepEqual(installedTuis, [{ id: "first" }, { id: "second" }]);
  assert.equal(first.state.activeWidgets.size, 0);
  assert.equal(second.state.activeWidgets.size, 0);
  assert.equal(first.state.footerCalls + second.state.footerCalls, 0);
  assert.equal(first.state.editorCalls + second.state.editorCalls, 0);
});

test("is a dependency-free no-op outside TUI mode", async () => {
  const { context, state } = createContext("print");
  let introCalls = 0;
  let platformCalls = 0;
  let installCalls = 0;
  const runtime = new FixedBottomSessionRuntime({
    playIntro: async () => {
      introCalls += 1;
      return false;
    },
    loadPlatform: async () => {
      platformCalls += 1;
      return platform();
    },
    installCompositor: () => {
      installCalls += 1;
      return { installed: true, compositor: new FakeCompositor() };
    },
  });

  await runtime.start({ reason: "startup" }, context);

  assert.equal(introCalls, 0);
  assert.equal(platformCalls, 0);
  assert.equal(installCalls, 0);
  assert.equal(state.widgetCalls.length, 0);
  assert.equal(state.notifications.length, 0);
});

test("rejects unsupported Pi exactly, warns once, and never calls the installer", async () => {
  const { context, state } = createContext();
  let installCalls = 0;
  const runtime = new FixedBottomSessionRuntime({
    loadPlatform: async () => platform("0.80.8"),
    installCompositor: () => {
      installCalls += 1;
      return { installed: true, compositor: new FakeCompositor() };
    },
  });

  await runtime.start({ reason: "reload" }, context);
  await runtime.start({ reason: "resume" }, context);

  assert.equal(installCalls, 0);
  assert.equal(state.widgetCalls.length, 0);
  assert.equal(state.notifications.length, 1);
  assert.match(state.notifications[0][0], /expected 0\.80\.7, received 0\.80\.8/);
  assert.match(state.notifications[0][0], /normal UI remains active/);
  assert.equal(state.notifications[0][1], "warning");
});

test("failed installation removes bootstrap state, keeps normal UI ownership, and warns once", async () => {
  const { context, state } = createContext();
  let installCalls = 0;
  const runtime = new FixedBottomSessionRuntime({
    loadPlatform: async () => platform(),
    installCompositor: () => {
      installCalls += 1;
      return { installed: false, reason: "preflight rejected the root" };
    },
  });

  await runtime.start({ reason: "reload" }, context);
  await runtime.start({ reason: "resume" }, context);

  assert.equal(installCalls, 2);
  assert.equal(state.activeWidgets.size, 0);
  assert.equal(state.footerCalls, 0);
  assert.equal(state.editorCalls, 0);
  assert.equal(state.notifications.length, 1);
  assert.match(state.notifications[0][0], /preflight rejected the root/);
});

test("ignores late async startup work after shutdown invalidates the generation", async () => {
  const { context, state } = createContext();
  let resolvePlatform!: (value: FixedBottomPlatform) => void;
  const pendingPlatform = new Promise<FixedBottomPlatform>((resolve) => {
    resolvePlatform = resolve;
  });
  let installCalls = 0;
  const runtime = new FixedBottomSessionRuntime({
    loadPlatform: () => pendingPlatform,
    installCompositor: () => {
      installCalls += 1;
      return { installed: true, compositor: new FakeCompositor() };
    },
  });

  const starting = runtime.start({ reason: "reload" }, context);
  runtime.shutdown({ reason: "reload" });
  resolvePlatform(platform());
  await starting;

  assert.equal(installCalls, 0);
  assert.equal(state.widgetCalls.length, 0);
  assert.equal(state.notifications.length, 0);
});

test("input follows the compositor bottom without returning an input transform", async () => {
  const { context } = createContext();
  const compositor = new FakeCompositor();
  const runtime = new FixedBottomSessionRuntime({
    loadPlatform: async () => platform(),
    installCompositor: () => ({ installed: true, compositor }),
  });

  assert.equal(runtime.input(), undefined);
  await runtime.start({ reason: "reload" }, context);
  assert.equal(runtime.input(), undefined);
  assert.equal(compositor.jumpCalls, 1);
});

test("manual intro reuses the overlay player and requests exactly one repaint after it closes", async () => {
  const order: string[] = [];
  const { context } = createContext();
  const compositor = new FakeCompositor(order);
  const runtime = new FixedBottomSessionRuntime({
    playIntro: async () => {
      order.push("overlay:open");
      await Promise.resolve();
      order.push("overlay:closed");
      return true;
    },
    loadPlatform: async () => platform(),
    installCompositor: () => ({ installed: true, compositor }),
  });

  await runtime.start({ reason: "reload" }, context);
  assert.equal(await runtime.replayIntro(context), true);

  assert.deepEqual(order, ["overlay:open", "overlay:closed", "repaint"]);
  assert.equal(compositor.repaintCalls, 1);
});

test("manual intro preserves the non-TUI error without loading platform code", async () => {
  const { context, state } = createContext("json");
  let introCalls = 0;
  const runtime = new FixedBottomSessionRuntime({
    playIntro: async () => {
      introCalls += 1;
      return true;
    },
  });

  assert.equal(await runtime.replayIntro(context), false);
  assert.equal(introCalls, 0);
  assert.deepEqual(state.notifications, [[
    "The PI introduction requires interactive TUI mode.",
    "error",
  ]]);
});

test("shutdown quiesces the host only for quit and uses ordinary disposal for replacements", async () => {
  for (const reason of ["quit", "reload", "new", "resume", "fork"]) {
    const { context } = createContext();
    const compositor = new FakeCompositor();
    const runtime = new FixedBottomSessionRuntime({
      loadPlatform: async () => platform(),
      installCompositor: () => ({ installed: true, compositor }),
    });

    await runtime.start({ reason: "reload" }, context);
    runtime.shutdown({ reason });

    assert.deepEqual(
      compositor.disposeOptions,
      reason === "quit" ? [{ quiesceHost: true }] : [undefined],
      reason,
    );
  }
});

test("shutdown invalidates first, disposes once, clears bootstrap state, and drops runtime refs", async () => {
  const order: string[] = [];
  const { context, state } = createContext("tui", { id: "tui" }, order);
  const compositor = new FakeCompositor(order);
  const runtime = new FixedBottomSessionRuntime({
    loadPlatform: async () => platform(),
    installCompositor: () => ({ installed: true, compositor }),
  });

  await runtime.start({ reason: "reload" }, context);
  const bootstrapKey = state.widgetCalls[0].key;
  order.length = 0;

  runtime.shutdown({ reason: "reload" });
  runtime.shutdown({ reason: "reload" });
  runtime.input();

  assert.deepEqual(order, ["dispose", "widget:remove"]);
  assert.equal(compositor.disposeCalls, 1);
  assert.deepEqual(compositor.disposeOptions, [undefined]);
  assert.equal(compositor.jumpCalls, 0);
  assert.deepEqual(
    state.widgetCalls.map((call) => [call.key, typeof call.content]),
    [
      [bootstrapKey, "function"],
      [bootstrapKey, "undefined"],
      [bootstrapKey, "undefined"],
    ],
  );
});
