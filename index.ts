import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  FixedBottomSessionRuntime,
  type FixedBottomSessionContext,
} from "./fixed-bottom/session-runtime.ts";

export default function piIntroExtension(
  pi: ExtensionAPI,
  runtime = new FixedBottomSessionRuntime(),
): void {
  pi.on("session_start", (event, context) => {
    void runtime.start(event, context as FixedBottomSessionContext);
  });

  pi.on("session_shutdown", () => {
    runtime.shutdown();
  });

  pi.on("input", () => runtime.input());

  pi.registerCommand("intro", {
    description: "Replay the PI startup introduction",
    handler: async (_args, context) => {
      await runtime.replayIntro(context as FixedBottomSessionContext);
    },
  });
}
