import type { CursorWidthSemantics } from "./contracts.ts";
import type { KittyImageDelete } from "./paint.ts";

export const PI_TUI_MODULE = "@earendil-works/pi-tui";

export interface FixedBottomPlatform {
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
  const tui = await importer(PI_TUI_MODULE);

  const cursorMarker = tui.CURSOR_MARKER;
  const visibleWidth = tui.visibleWidth;
  if (typeof cursorMarker !== "string" || typeof visibleWidth !== "function") {
    throw new TypeError("Pi TUI did not export public cursor/width semantics");
  }

  const deleteKittyImage = publicKittyDeleteAdapter(tui.deleteKittyImage);
  return {
    semantics: {
      cursorMarker,
      visibleWidth: visibleWidth as CursorWidthSemantics["visibleWidth"],
    },
    ...(deleteKittyImage ? { deleteKittyImage } : {}),
  };
}
