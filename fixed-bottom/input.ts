import type {
  FixedBottomInputListener,
  ViewportState,
} from "./contracts.ts";
import {
  followViewportBottom,
  scrollViewport,
} from "./viewport.ts";

export type FixedBottomScrollAction =
  | "page-up"
  | "page-down"
  | "line-up"
  | "line-down"
  | "top"
  | "bottom";

const SCROLL_KEYS = new Map<string, FixedBottomScrollAction>([
  ["\x1b[5~", "page-up"],
  ["\x1b[5;2~", "page-up"],
  ["\x1b[6~", "page-down"],
  ["\x1b[6;2~", "page-down"],
  ["\x1b[1;5A", "line-up"],
  ["\x1b[1;5B", "line-down"],
  ["\x1b[1;5H", "top"],
  ["\x1b[1;5F", "bottom"],
]);

export interface FixedBottomInputOptions {
  getState(): ViewportState;
  setState(state: ViewportState): void;
  getVisibleRows(): number;
  isSuspended?(): boolean;
  requestRender(): void;
}

export function fixedBottomScrollAction(data: string): FixedBottomScrollAction | undefined {
  return SCROLL_KEYS.get(data);
}

export function createFixedBottomInputListener(
  options: FixedBottomInputOptions,
): FixedBottomInputListener {
  return (data) => {
    const action = fixedBottomScrollAction(data);
    if (!action || options.isSuspended?.()) return undefined;

    const visibleRows = Math.max(1, Math.floor(options.getVisibleRows()));
    const pageRows = Math.max(1, visibleRows - 1);
    const state = options.getState();
    let next: ViewportState;

    switch (action) {
      case "page-up":
        next = scrollViewport(state, pageRows, visibleRows).state;
        break;
      case "page-down":
        next = scrollViewport(state, -pageRows, visibleRows).state;
        break;
      case "line-up":
        next = scrollViewport(state, 1, visibleRows).state;
        break;
      case "line-down":
        next = scrollViewport(state, -1, visibleRows).state;
        break;
      case "top":
        next = scrollViewport(state, Number.MAX_SAFE_INTEGER, visibleRows).state;
        break;
      case "bottom":
        next = followViewportBottom(state, visibleRows).state;
        break;
    }

    options.setState(next);
    options.requestRender();
    return { consume: true };
  };
}
