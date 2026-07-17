import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_STYLE,
  STYLE_PRESETS,
  resolveIntroStyle,
  type IntroStyle,
  type IntroStyleName,
} from "./intro-component.ts";

export const CUSTOM_WORD_CHOICE = "✏️  Custom word…";
const PREVIEW_TAGLINE = "W E L C O M E   B A C K";

export interface IntroCommandUi {
  select(title: string, options: string[]): Promise<string | undefined>;
  input(title: string, placeholder?: string): Promise<string | undefined>;
  editor(title: string, prefill?: string): Promise<string | undefined>;
  notify(message: string, type?: "info" | "warning" | "error"): void;
}

export interface IntroCommandOptions {
  /** Current session style (env-derived). Used to prefill the dialogs. */
  currentStyle: IntroStyle;
  /** Called with the chosen style; should update session state and replay the intro as a preview. */
  apply(style: IntroStyle): Promise<void>;
}

function presetDisplay(name: IntroStyleName): string {
  const preset = STYLE_PRESETS[name];
  const word = preset.word ?? "PI";
  const color = preset.hex ?? "theme accent";
  return name === "pi" ? `${word} — default (theme accent)` : `${word} — ${color}`;
}

function presetNameFromDisplay(choice: string): IntroStyleName | undefined {
  const names = Object.keys(STYLE_PRESETS) as IntroStyleName[];
  return names.find((name) => presetDisplay(name) === choice);
}

/** Display tagline: presets store it pre-spaced; show it plainly for editing. */
function plainTagline(tagline: string | undefined): string {
  return (tagline ?? PREVIEW_TAGLINE).replace(/\s+/g, " ").trim();
}

/** Re-space an edited tagline the way the presets render it ("W E L C O M E"). */
export function stylizeTagline(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) return "";
  // Already stylized (single letters, spaced, with a wider word gap) — keep it.
  if (/^(?:\p{Lu} )+\p{Lu}(?: {2,}(?:\p{Lu} )+\p{Lu})*$/u.test(trimmed)) return trimmed;

  const plain = trimmed.replace(/\s+/g, " ");
  return plain.split(" ").map((word) => Array.from(word).join(" ")).join("   ").toUpperCase();
}

/**
 * Interactive /pi-intro flow: pick a preset (or custom word), edit the bottom
 * message in a prefilled editor, then apply + preview the result.
 */
export async function runIntroCommand(ui: IntroCommandUi, options: IntroCommandOptions): Promise<void> {
  const current = resolveIntroStyle(options.currentStyle);
  const presetNames = Object.keys(STYLE_PRESETS) as IntroStyleName[];
  const choices = [...presetNames.map(presetDisplay), CUSTOM_WORD_CHOICE];

  const choice = await ui.select("PI intro style:", choices);
  if (choice === undefined) return;

  let next: IntroStyle;

  if (choice === CUSTOM_WORD_CHOICE) {
    const word = await ui.input("Big word (A–Z, space, apostrophe):", current.word ?? "SHOPIFY");
    if (word === undefined) return;

    const trimmed = word.trim();
    if (trimmed.length === 0) {
      ui.notify("Intro unchanged: empty word", "warning");
      return;
    }

    next = { word: trimmed.toUpperCase(), hex: current.hex ?? STYLE_PRESETS.shopify.hex };
  } else {
    const name = presetNameFromDisplay(choice);
    if (name === undefined) return;
    next = { ...resolveIntroStyle(name) };
  }

  const editedTagline = await ui.editor("Bottom message (empty to hide):", plainTagline(next.tagline ?? current.tagline));
  if (editedTagline === undefined) return;

  const tagline = stylizeTagline(editedTagline);
  next = tagline.length === 0 ? { ...next, tagline: undefined } : { ...next, tagline };

  await options.apply(next);

  ui.notify("Intro saved — it will greet you on every startup", "info");
}

/** Register the /pi-intro command against the real ExtensionAPI. */
export function registerIntroCommand(
  pi: ExtensionAPI,
  getStyle: () => IntroStyle,
  apply: (style: IntroStyle, ctx: ExtensionCommandContext) => Promise<void>,
): void {
  pi.registerCommand("pi-intro", {
    description: "Choose the PI startup intro: preset big word, colors, and bottom message",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("/pi-intro needs interactive TUI mode", "warning");
        return;
      }
      await runIntroCommand(ctx.ui, {
        currentStyle: getStyle(),
        apply: (style) => apply(style, ctx),
      });
    },
  });
}
