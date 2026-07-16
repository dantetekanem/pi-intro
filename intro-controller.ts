import { PiIntroComponent, type IntroTheme } from "./intro-component.ts";

export const FULL_SCREEN_OVERLAY_OPTIONS = {
  overlay: true,
  overlayOptions: {
    width: "100%",
    maxHeight: "100%",
    row: 0,
    col: 0,
    margin: 0,
  },
} as const;

interface IntroTui {
  terminal: {
    rows: number;
  };
  requestRender(): void;
}

export interface IntroContext {
  mode: string;
  ui: {
    custom<T>(
      factory: (tui: IntroTui, theme: unknown, keybindings: unknown, done: (value: T) => void) => PiIntroComponent,
      options: typeof FULL_SCREEN_OVERLAY_OPTIONS,
    ): Promise<T | undefined>;
  };
}

export function shouldAutoPlay(reason: string, mode: string): boolean {
  return reason === "startup" && mode === "tui";
}

export async function playIntro(context: IntroContext): Promise<boolean> {
  if (context.mode !== "tui") return false;

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
    });

    component.start();
    return component;
  }, FULL_SCREEN_OVERLAY_OPTIONS);

  return true;
}
