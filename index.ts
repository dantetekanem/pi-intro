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

export default function piIntroExtension(
  pi: ExtensionAPI,
  introPlayer = playIntro,
  spacerInstaller = installBottomSpacer,
  commandRegistrar: typeof registerIntroCommand = registerIntroCommand,
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
        await playWithSessionStyle(context as IntroContext);
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
