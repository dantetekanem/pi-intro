import {
  EXPECTED_ROOT_CHILDREN,
} from "./compatibility.ts";
import type {
  FixedBottomClusterInput,
  FixedBottomRenderable,
  LineBlock,
} from "./contracts.ts";

export interface FixedBottomTopologyRender {
  readonly transcriptLines: readonly string[];
  readonly clusterInput: Omit<FixedBottomClusterInput, "terminalRows" | "width">;
}

function renderLines(component: FixedBottomRenderable, width: number): string[] {
  const lines = component.render(width);
  if (!Array.isArray(lines) || !lines.every((line) => typeof line === "string")) {
    throw new TypeError("fixed-bottom renderables must return string arrays");
  }
  return [...lines];
}

function renderBlock(component: FixedBottomRenderable, width: number): LineBlock {
  return { lines: renderLines(component, width) };
}

function renderAtomicChildren(
  container: FixedBottomRenderable,
  width: number,
): LineBlock[] {
  if (!Array.isArray(container.children)) {
    const block = renderBlock(container, width);
    return block.lines.length > 0 ? [block] : [];
  }

  return container.children
    .map((child) => renderBlock(child, width))
    .filter((block) => block.lines.length > 0);
}

export function renderFixedBottomTopology(
  rootChildren: readonly FixedBottomRenderable[],
  width: number,
): FixedBottomTopologyRender {
  if (rootChildren.length !== EXPECTED_ROOT_CHILDREN) {
    throw new Error(`fixed-bottom topology changed: expected ${EXPECTED_ROOT_CHILDREN} root children`);
  }

  const [
    header,
    loadedResources,
    chat,
    pendingMessages,
    status,
    aboveWidgets,
    editor,
    belowWidgets,
    footer,
  ] = rootChildren;

  const transcriptLines = [header, loadedResources, chat, pendingMessages]
    .flatMap((component) => renderLines(component, width));

  return {
    transcriptLines,
    clusterInput: {
      status: renderBlock(status, width),
      aboveWidgets: renderAtomicChildren(aboveWidgets, width),
      editor: renderBlock(editor, width),
      belowWidgets: renderAtomicChildren(belowWidgets, width),
      footer: renderBlock(footer, width),
    },
  };
}
