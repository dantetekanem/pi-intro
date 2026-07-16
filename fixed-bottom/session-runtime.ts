import {
  installFixedBottomCompositor,
  type FixedBottomCompositor,
  type InstallFixedBottomCompositorOptions,
  type InstallFixedBottomCompositorResult,
} from "./compositor.ts";
import { SUPPORTED_PI_VERSION } from "./compatibility.ts";
import type { FixedBottomTui } from "./contracts.ts";
import {
  loadFixedBottomPlatform,
  type FixedBottomPlatform,
} from "./platform.ts";
import { playIntro, type IntroContext } from "../intro-controller.ts";

const BOOTSTRAP_WIDGET_PREFIX = "pi-intro.fixed-bottom.bootstrap";
const FIXED_BOTTOM_WARNING_PREFIX = "Fixed-bottom mode is unavailable";
let bootstrapSequence = 0;

interface ZeroLineComponent {
  render(width: number): string[];
  invalidate(): void;
}

interface SessionRuntimeUi {
  setWidget(
    key: string,
    content: ((tui: unknown, theme: unknown) => ZeroLineComponent) | undefined,
  ): void;
  notify(message: string, level: "warning" | "error"): void;
}

export interface FixedBottomSessionContext extends IntroContext {
  readonly ui: IntroContext["ui"] & SessionRuntimeUi;
}

export interface SessionStartEvent {
  readonly reason: string;
}

export type FixedBottomPlatformLoader = () => Promise<FixedBottomPlatform>;
export type FixedBottomInstaller = (
  options: InstallFixedBottomCompositorOptions,
) => InstallFixedBottomCompositorResult;
export type IntroPlayer = (context: IntroContext) => Promise<boolean>;

export interface FixedBottomSessionRuntimeOptions {
  readonly loadPlatform?: FixedBottomPlatformLoader;
  readonly installCompositor?: FixedBottomInstaller;
  readonly playIntro?: IntroPlayer;
}

function zeroLineComponent(): ZeroLineComponent {
  return {
    render: () => [],
    invalidate: () => {},
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class FixedBottomSessionRuntime {
  private readonly loadPlatform: FixedBottomPlatformLoader;
  private readonly installCompositor: FixedBottomInstaller;
  private readonly introPlayer: IntroPlayer;

  private generation = 0;
  private compositor: FixedBottomCompositor | null = null;
  private sessionContext: FixedBottomSessionContext | null = null;
  private bootstrapWidgetKey: string | null = null;
  private warned = false;

  constructor(options: FixedBottomSessionRuntimeOptions = {}) {
    this.loadPlatform = options.loadPlatform ?? loadFixedBottomPlatform;
    this.installCompositor = options.installCompositor ?? installFixedBottomCompositor;
    this.introPlayer = options.playIntro ?? playIntro;
  }

  async start(
    event: SessionStartEvent,
    context: FixedBottomSessionContext,
  ): Promise<void> {
    const generation = ++this.generation;
    if (context.mode !== "tui") return;

    this.sessionContext = context;

    try {
      if (event.reason === "startup") {
        await this.introPlayer(context);
        if (!this.isCurrent(generation)) return;
      }

      const platform = await this.loadPlatform();
      if (!this.isCurrent(generation)) return;

      if (platform.runtimeVersion !== SUPPORTED_PI_VERSION) {
        this.warnOnce(
          context,
          `unsupported Pi version: expected ${SUPPORTED_PI_VERSION}, received ${platform.runtimeVersion}`,
        );
        return;
      }

      const tui = this.captureTui(context);
      if (!this.isCurrent(generation)) return;
      if (!tui) {
        this.warnOnce(context, "Pi did not synchronously expose its TUI through setWidget");
        return;
      }

      const result = this.installCompositor({
        tui,
        runtimeVersion: platform.runtimeVersion,
        semantics: platform.semantics,
        deleteKittyImage: platform.deleteKittyImage,
      });

      if (!this.isCurrent(generation)) {
        if (result.installed) result.compositor.dispose();
        return;
      }
      if (!result.installed) {
        this.warnOnce(context, result.reason);
        return;
      }

      this.compositor = result.compositor;
    } catch (error) {
      if (this.isCurrent(generation)) this.warnOnce(context, errorMessage(error));
    }
  }

  input(): undefined {
    this.compositor?.jumpToBottom();
    return undefined;
  }

  async replayIntro(context: FixedBottomSessionContext): Promise<boolean> {
    if (context.mode !== "tui") {
      context.ui.notify("The PI introduction requires interactive TUI mode.", "error");
      return false;
    }

    const generation = this.generation;
    const played = await this.introPlayer(context);
    if (this.isCurrent(generation)) this.compositor?.requestRepaint();
    return played;
  }

  shutdown(): void {
    ++this.generation;

    const compositor = this.compositor;
    const context = this.sessionContext;
    const bootstrapWidgetKey = this.bootstrapWidgetKey;

    try {
      compositor?.dispose();
    } finally {
      try {
        if (context && bootstrapWidgetKey) {
          context.ui.setWidget(bootstrapWidgetKey, undefined);
        }
      } finally {
        this.compositor = null;
        this.sessionContext = null;
        this.bootstrapWidgetKey = null;
      }
    }
  }

  private isCurrent(generation: number): boolean {
    return generation === this.generation;
  }

  private captureTui(context: FixedBottomSessionContext): FixedBottomTui | null {
    const key = `${BOOTSTRAP_WIDGET_PREFIX}.${++bootstrapSequence}`;
    this.bootstrapWidgetKey = key;
    let tui: unknown;

    try {
      context.ui.setWidget(key, (candidate) => {
        tui = candidate;
        return zeroLineComponent();
      });
    } finally {
      context.ui.setWidget(key, undefined);
    }

    return (tui ?? null) as FixedBottomTui | null;
  }

  private warnOnce(context: FixedBottomSessionContext, reason: string): void {
    if (this.warned) return;
    this.warned = true;
    context.ui.notify(
      `${FIXED_BOTTOM_WARNING_PREFIX}: ${reason}. Pi's normal UI remains active.`,
      "warning",
    );
  }
}
