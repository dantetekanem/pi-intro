import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";

const WIDGET_PREFIX = "pi-intro.bottom-spacer";
let spacerSequence = 0;

export function installBottomSpacer(
  ui: Pick<ExtensionContext["ui"], "setWidget">,
): (() => void) | undefined {
  const id = ++spacerSequence;
  const widgetKey = `${WIDGET_PREFIX}.${id}`;
  const marker = `\0${widgetKey}\0`;
  let tui: TUI | undefined;
  let markerActive = false;
  const markerComponent = {
    render: () => markerActive ? [marker] : [],
    invalidate: () => {},
  };

  ui.setWidget(widgetKey, (candidate) => {
    tui = candidate;
    return markerComponent;
  }, { placement: "aboveEditor" });

  if (!tui) {
    ui.setWidget(widgetKey, undefined);
    return undefined;
  }

  const widgetContainerIndex = tui.children.findIndex((child) => {
    if (!child || typeof child !== "object") return false;
    const children = (child as { children?: unknown }).children;
    return Array.isArray(children) && children.includes(markerComponent);
  });
  if (widgetContainerIndex < 1) {
    ui.setWidget(widgetKey, undefined);
    return undefined;
  }

  ui.setWidget(widgetKey, undefined);
  tui.children.splice(widgetContainerIndex - 1, 0, markerComponent);
  markerActive = true;

  const originalRender = tui.render;
  const renderWithBottomSpacer = (width: number): string[] => {
    const lines = originalRender.call(tui, width);
    const markerIndex = lines.indexOf(marker);
    if (markerIndex === -1) return lines;

    const linesWithoutMarker = [
      ...lines.slice(0, markerIndex),
      ...lines.slice(markerIndex + 1),
    ];
    const missing = Math.max(0, tui.terminal.rows - linesWithoutMarker.length);

    return [
      ...linesWithoutMarker.slice(0, markerIndex),
      ...new Array<string>(missing).fill(""),
      ...linesWithoutMarker.slice(markerIndex),
    ];
  };

  tui.render = renderWithBottomSpacer;
  tui.requestRender();

  return () => {
    markerActive = false;
    if (tui.render === renderWithBottomSpacer) tui.render = originalRender;
    const markerIndex = tui.children.indexOf(markerComponent);
    if (markerIndex !== -1) tui.children.splice(markerIndex, 1);
    tui.requestRender();
  };
}
