import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installBottomSpacer } from "./bottom-spacer.ts";
import { playIntro, type IntroContext } from "./intro-controller.ts";

export default function piIntroExtension(
  pi: ExtensionAPI,
  introPlayer = playIntro,
  spacerInstaller = installBottomSpacer,
): void {
  let generation = 0;
  let removeSpacer: (() => void) | undefined;

  pi.on("session_start", (event, context) => {
    const sessionGeneration = ++generation;

    void (async () => {
      if (event.reason === "startup") {
        await introPlayer(context as IntroContext);
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
}
