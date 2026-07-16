import type { TerminalModeSnapshot } from "./contracts.ts";

export type { TerminalModeSnapshot };

const SYNCHRONIZED_OUTPUT_ON = "\x1b[?2026h";
const SYNCHRONIZED_OUTPUT_OFF = "\x1b[?2026l";
const ALTERNATE_SCREEN_ON = "\x1b[?1049h";
const ALTERNATE_SCREEN_OFF = "\x1b[?1049l";
const ALTERNATE_SCROLL_ON = "\x1b[?1007h";
const ALTERNATE_SCROLL_OFF = "\x1b[?1007l";
const RESET_SCROLL_REGION = "\x1b[r";

function terminalRow(value: number): number {
  if (!Number.isFinite(value) || value < 1) {
    throw new RangeError("scrollBottom must be a positive terminal row");
  }
  return Math.floor(value);
}

function synchronized(sequence: string): string {
  return `${SYNCHRONIZED_OUTPUT_ON}${sequence}${SYNCHRONIZED_OUTPUT_OFF}`;
}

export function setScrollRegion(top: number, bottom: number): string {
  const first = terminalRow(top);
  const last = terminalRow(bottom);
  if (first > last) throw new RangeError("scroll region top cannot exceed bottom");
  return `\x1b[${first};${last}r`;
}

export function enterFixedBottomMode(scrollBottom: number): string {
  return synchronized(
    ALTERNATE_SCREEN_ON
    + ALTERNATE_SCROLL_OFF
    + setScrollRegion(1, scrollBottom),
  );
}

export function updateFixedBottomScrollRegion(scrollBottom: number): string {
  return synchronized(RESET_SCROLL_REGION + setScrollRegion(1, scrollBottom));
}

export function restoreTerminalModes(): string {
  return synchronized(
    RESET_SCROLL_REGION
    + ALTERNATE_SCROLL_ON
    + ALTERNATE_SCREEN_OFF,
  );
}

export class FixedBottomTerminalModes {
  private active = false;
  private scrollBottom: number | null = null;

  snapshot(): TerminalModeSnapshot {
    return { active: this.active, scrollBottom: this.scrollBottom };
  }

  enter(scrollBottom: number): string {
    const bottom = terminalRow(scrollBottom);
    if (this.active) return this.updateScrollRegion(bottom);

    this.active = true;
    this.scrollBottom = bottom;
    return enterFixedBottomMode(bottom);
  }

  updateScrollRegion(scrollBottom: number): string {
    const bottom = terminalRow(scrollBottom);
    if (!this.active || this.scrollBottom === bottom) return "";

    this.scrollBottom = bottom;
    return updateFixedBottomScrollRegion(bottom);
  }

  restore(): string {
    if (!this.active) return "";

    this.active = false;
    this.scrollBottom = null;
    return restoreTerminalModes();
  }
}
