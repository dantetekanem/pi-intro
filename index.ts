import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { installBottomSpacer } from "./bottom-spacer.ts";
import { playIntro, type IntroContext } from "./intro-controller.ts";
import { registerIntroCommand } from "./intro-command.ts";
import { configToStyle, loadIntroConfig, saveIntroConfig, styleToConfig } from "./intro-config.ts";
import { resolveIntroStyle, type IntroStyle } from "./intro-component.ts";

/** Env vars override the persisted config; both are optional. */
function envStyle(): IntroStyle {
  const preset = process.env.PI_INTRO_STYLE;
  const word = process.env.PI_INTRO_WORD;
  const hex = process.env.PI_INTRO_COLOR;
  const tagline = process.env.PI_INTRO_TAGLINE;

  const base = typeof preset === "string" ? resolveIntroStyle(preset) : {};
  return {
    ...base,
    ...(word === undefined ? {} : { word }),
    ...(hex === undefined ? {} : { hex }),
    ...(tagline === undefined ? {} : { tagline }),
  };
}

/** Startup style: persisted config as base, env vars on top. */
function startupStyle(): IntroStyle {
  return resolveIntroStyle({ ...configToStyle(loadIntroConfig()), ...definedOnly(envStyle()) });
}

function definedOnly(style: IntroStyle): IntroStyle {
  const out: IntroStyle = {};
  if (style.word !== undefined) out.word = style.word;
  if (style.hex !== undefined) out.hex = style.hex;
  if (style.tagline !== undefined) out.tagline = style.tagline;
  return out;
}

const VALUE_FLAGS = new Set([
  "--provider",
  "--model",
  "--api-key",
  "--system-prompt",
  "--append-system-prompt",
  "--name",
  "-n",
  "--session",
  "--session-id",
  "--fork",
  "--session-dir",
  "--models",
  "--tools",
  "-t",
  "--exclude-tools",
  "-xt",
  "--thinking",
  "--mode",
  "--export",
  "--extension",
  "-e",
  "--skill",
  "--prompt-template",
  "--theme",
  "--tui-mode",
]);

const BOOLEAN_FLAGS = new Set([
  "--continue",
  "-c",
  "--resume",
  "-r",
  "--no-session",
  "--no-tools",
  "-nt",
  "--no-builtin-tools",
  "-nbt",
  "--no-extensions",
  "-ne",
  "--no-skills",
  "-ns",
  "--no-prompt-templates",
  "-np",
  "--no-themes",
  "--no-context-files",
  "-nc",
  "--verbose",
  "--approve",
  "-a",
  "--no-approve",
  "-na",
  "--offline",
  "--print",
  "-p",
]);

export function hasInitialCliInput(args = process.argv.slice(2)): boolean {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith("@")) return true;
    if (VALUE_FLAGS.has(arg)) {
      index += 1;
      continue;
    }
    if (BOOLEAN_FLAGS.has(arg)) continue;
    if (arg.startsWith("--")) {
      const next = args[index + 1];
      if (!arg.includes("=") && next !== undefined && !next.startsWith("-") && !next.startsWith("@")) index += 1;
      continue;
    }
    if (!arg.startsWith("-")) return true;
  }
  return false;
}

export default function piIntroExtension(
  pi: ExtensionAPI,
  introPlayer = playIntro,
  spacerInstaller = installBottomSpacer,
  commandRegistrar: typeof registerIntroCommand = registerIntroCommand,
  initialInputDetector = hasInitialCliInput,
): void {
  let generation = 0;
  let removeSpacer: (() => void) | undefined;
  // Session-level style: startup value, /pi-intro updates it live and persists it.
  let sessionStyle: IntroStyle = startupStyle();

  const playWithSessionStyle = (context: IntroContext, _style?: IntroStyle | string) =>
    introPlayer(context, sessionStyle);

  pi.on("session_start", (event, context) => {
    const sessionGeneration = ++generation;

    void (async () => {
      if (event.reason === "startup") {
        sessionStyle = startupStyle();
        if (!initialInputDetector()) await playWithSessionStyle(context as IntroContext);
      }

      if (sessionGeneration !== generation || context.mode !== "tui") return;
      removeSpacer = spacerInstaller(context.ui);
    })().catch(() => {});
  });

  pi.on("session_shutdown", () => {
    ++generation;
    removeSpacer?.();
    removeSpacer = undefined;
  });

  commandRegistrar(
    pi,
    () => sessionStyle,
    async (style: IntroStyle, ctx: ExtensionCommandContext) => {
      sessionStyle = resolveIntroStyle(style);
      saveIntroConfig(styleToConfig(sessionStyle));
      // Replay the intro as a live preview of the new style.
      await playWithSessionStyle(ctx as unknown as IntroContext);
    },
  );
}
