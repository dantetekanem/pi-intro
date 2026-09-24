import { isKeyRelease } from "@earendil-works/pi-tui";
import {
  DEFAULT_STYLE,
  PiIntroComponent,
  isIntroSkipInput,
  resolveIntroStyle,
  type IntroStyle,
  type IntroTheme,
} from "./intro-component.ts";

export const FULL_SCREEN_OVERLAY_OPTIONS = {
  overlay: true,
  overlayOptions: {
    nonCapturing: true,
    width: "100%",
    maxHeight: "100%",
    row: 0,
    col: 0,
    margin: 0,
  },
} as const;

interface IntroInputListenerResult {
  consume?: boolean;
  data?: string;
}

interface IntroTui {
  terminal: {
    rows: number;
  };
  requestRender(): void;
  addInputListener(
    listener: (data: string) => IntroInputListenerResult | undefined,
  ): () => void;
}

interface IntroUiComponent {
  render(width: number): string[];
  handleInput(data: string): void;
  invalidate(): void;
  dispose(): void;
}

export interface IntroContext {
  mode: string;
  ui: {
    custom<T>(
      factory: (tui: IntroTui, theme: unknown, keybindings: unknown, done: (value: T) => void) => IntroUiComponent,
      options: typeof FULL_SCREEN_OVERLAY_OPTIONS,
    ): Promise<T | undefined>;
  };
}

export function shouldAutoPlay(reason: string, mode: string): boolean {
  return reason === "startup" && mode === "tui";
}

export async function playIntro(context: IntroContext, style?: IntroStyle | string): Promise<boolean> {
  if (context.mode !== "tui") return false;

  const resolvedStyle = resolveIntroStyle(style);

  await context.ui.custom<void>((tui, theme, _keybindings, done) => {
    const component = new PiIntroComponent({
      host: {
        get rows() {
          return tui.terminal.rows;
        },
        requestRender: () => tui.requestRender(),
      },
      theme: theme as IntroTheme,
      onDone: () => done(undefined),
      ...(resolvedStyle === DEFAULT_STYLE ? {} : { style: resolvedStyle }),
    });

    const removeInputListener = tui.addInputListener((data) => {
      if (isKeyRelease(data) || !isIntroSkipInput(data)) return undefined;

      component.handleInput(data);
      return { consume: true };
    });
    let disposed = false;

    component.start();
    return {
      render: (width) => component.render(width),
      handleInput: (data) => component.handleInput(data),
      invalidate: () => component.invalidate(),
      dispose: () => {
        if (disposed) return;
        disposed = true;
        removeInputListener();
        component.dispose();
      },
    };
  }, FULL_SCREEN_OVERLAY_OPTIONS);

  return true;
}
