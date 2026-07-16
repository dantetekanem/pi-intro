import type { CursorWidthSemantics } from "./contracts.ts";
import type { KittyImageDelete } from "./paint.ts";

export const PI_CODING_AGENT_MODULE = "@earendil-works/pi-coding-agent";
export const PI_TUI_MODULE = "@earendil-works/pi-tui";

export interface FixedBottomPlatform {
  readonly runtimeVersion: string;
  readonly semantics: CursorWidthSemantics;
  readonly deleteKittyImage?: KittyImageDelete;
}

export type RuntimeModuleImporter = (
  specifier: string,
) => Promise<Record<string, unknown>>;

function defaultImporter(specifier: string): Promise<Record<string, unknown>> {
  return import(specifier) as Promise<Record<string, unknown>>;
}

function publicKittyDeleteAdapter(candidate: unknown): KittyImageDelete | undefined {
  if (typeof candidate !== "function" || candidate.length !== 1) return undefined;

  return (imageId: number): string => {
    const sequence = Reflect.apply(candidate, undefined, [imageId]);
    if (typeof sequence !== "string") {
      throw new TypeError("public deleteKittyImage must return a terminal sequence string");
    }
    return sequence;
  };
}

export async function loadFixedBottomPlatform(
  importer: RuntimeModuleImporter = defaultImporter,
): Promise<FixedBottomPlatform> {
  const [codingAgent, tui] = await Promise.all([
    importer(PI_CODING_AGENT_MODULE),
    importer(PI_TUI_MODULE),
  ]);

  const runtimeVersion = codingAgent.VERSION;
  const cursorMarker = tui.CURSOR_MARKER;
  const visibleWidth = tui.visibleWidth;

  if (typeof runtimeVersion !== "string") {
    throw new TypeError("Pi runtime did not export VERSION as a string");
  }
  if (typeof cursorMarker !== "string" || typeof visibleWidth !== "function") {
    throw new TypeError("Pi TUI did not export public cursor/width semantics");
  }

  const deleteKittyImage = publicKittyDeleteAdapter(tui.deleteKittyImage);
  return {
    runtimeVersion,
    semantics: {
      cursorMarker,
      visibleWidth: visibleWidth as CursorWidthSemantics["visibleWidth"],
    },
    ...(deleteKittyImage ? { deleteKittyImage } : {}),
  };
}
