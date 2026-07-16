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

function mouseBaseButton(code: number): number {
  return code & ~(4 | 8 | 16 | 32);
}

export function fixedBottomMouseScrollDelta(data: string): number | undefined {
  const pattern = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;
  let offset = 0;
  let delta = 0;
  let found = false;

  for (const match of data.matchAll(pattern)) {
    if (match.index !== offset || match[4] !== "M") return undefined;
    offset = match.index + match[0].length;

    const button = mouseBaseButton(Number(match[1]));
    if (button === 64) delta += 3;
    else if (button === 65) delta -= 3;
    else return undefined;
    found = true;
  }

  return found && offset === data.length ? delta : undefined;
}

export function createFixedBottomInputListener(
  options: FixedBottomInputOptions,
): FixedBottomInputListener {
  return (data) => {
    const mouseDelta = fixedBottomMouseScrollDelta(data);
    const action = mouseDelta === undefined ? fixedBottomScrollAction(data) : undefined;
    if (mouseDelta === undefined && !action) return undefined;
    if (options.isSuspended?.()) {
      return mouseDelta === undefined ? undefined : { consume: true };
    }

    const visibleRows = Math.max(1, Math.floor(options.getVisibleRows()));
    const pageRows = Math.max(1, visibleRows - 1);
    const state = options.getState();
    let next: ViewportState;

    if (mouseDelta !== undefined) {
      next = scrollViewport(state, mouseDelta, visibleRows).state;
    } else switch (action) {
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
