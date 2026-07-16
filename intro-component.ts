export const INTRO_TRANSITION_MS = 1800;
export const INTRO_HOLD_MS = 750;
export const INTRO_DURATION_MS = INTRO_TRANSITION_MS + INTRO_HOLD_MS;
export const INTRO_FRAME_MS = 45;

const LOGO = [
  "██████╗  ██╗",
  "██╔══██╗ ██║",
  "██████╔╝ ██║",
  "██╔═══╝  ██║",
  "██║      ██║",
  "╚═╝      ╚═╝",
] as const;

export interface IntroTheme {
  fg(color: string, text: string): string;
  bold(text: string): string;
}

export interface IntroHost {
  readonly rows: number;
  requestRender(): void;
}

export interface IntroScheduler {
  now(): number;
  setInterval(callback: () => void, milliseconds: number): unknown;
  clearInterval(handle: unknown): void;
  setTimeout(callback: () => void, milliseconds: number): unknown;
  clearTimeout(handle: unknown): void;
}

interface IntroComponentOptions {
  host: IntroHost;
  theme: IntroTheme;
  onDone: () => void;
  scheduler?: IntroScheduler;
}

const systemScheduler: IntroScheduler = {
  now: () => Date.now(),
  setInterval: (callback, milliseconds) => setInterval(callback, milliseconds),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
  setTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function fillLine(width: number): string {
  return " ".repeat(Math.max(0, width));
}

function placeCentered(lines: string[], row: number, width: number, styled: string, visibleWidth: number): void {
  if (row < 0 || row >= lines.length || width <= 0) return;

  const clippedWidth = Math.min(width, visibleWidth);
  const left = Math.max(0, Math.floor((width - clippedWidth) / 2));
  const right = Math.max(0, width - left - clippedWidth);
  lines[row] = `${" ".repeat(left)}${styled}${" ".repeat(right)}`;
}

function styleLogoLine(
  line: string,
  reveal: number,
  sweep: number,
  fading: boolean,
  theme: IntroTheme,
): string {
  const characters = Array.from(line);
  const center = (characters.length - 1) / 2;
  const radius = reveal * (characters.length / 2 + 1);
  const sweepColumn = sweep * Math.max(0, characters.length - 1);

  return characters.map((character, index) => {
    if (Math.abs(index - center) > radius || character === " ") return " ";

    const color = fading ? "dim" : Math.abs(index - sweepColumn) < 1.25 ? "text" : "accent";
    return theme.bold(theme.fg(color, character));
  }).join("");
}

/**
 * Full-viewport, terminal-native PI reveal. It never writes to stdout or owns
 * the terminal buffer; Pi's overlay renderer remains the sole screen owner.
 */
export class PiIntroComponent {
  private readonly host: IntroHost;
  private readonly theme: IntroTheme;
  private readonly onDone: () => void;
  private readonly scheduler: IntroScheduler;
  private startedAt: number | null = null;
  private animationTimer: unknown;
  private transitionTimer: unknown;
  private holdTimer: unknown;
  private holding = false;
  private finished = false;

  constructor(options: IntroComponentOptions) {
    this.host = options.host;
    this.theme = options.theme;
    this.onDone = options.onDone;
    this.scheduler = options.scheduler ?? systemScheduler;
  }

  start(): void {
    if (this.startedAt !== null || this.finished) return;

    this.startedAt = this.scheduler.now();
    this.animationTimer = this.scheduler.setInterval(() => this.tick(), INTRO_FRAME_MS);
    this.transitionTimer = this.scheduler.setTimeout(() => {
      this.transitionTimer = undefined;
      this.beginHold();
    }, INTRO_TRANSITION_MS);
    this.host.requestRender();
  }

  handleInput(_data: string): void {
    this.finish();
  }

  render(width: number): string[] {
    const safeWidth = Math.max(0, Math.floor(width));
    const rows = Math.max(1, Math.floor(this.host.rows));
    const lines = Array.from({ length: rows }, () => fillLine(safeWidth));
    if (safeWidth === 0) return lines;

    const progress = this.progress();
    const centerRow = Math.floor(rows / 2);
    const fading = progress >= 0.88;

    if (rows < LOGO.length + 4 || safeWidth < LOGO[0].length + 4) {
      const compact = progress < 0.16 ? "·" : "PI";
      const color = fading ? "dim" : "accent";
      placeCentered(lines, centerRow, safeWidth, this.theme.bold(this.theme.fg(color, compact)), compact.length);
      return lines;
    }

    if (progress < 0.30) {
      const beamProgress = clamp((progress - 0.04) / 0.24);
      const beamRadius = Math.max(0, Math.floor(beamProgress * Math.min(4, Math.floor(rows / 4))));
      for (let offset = -beamRadius; offset <= beamRadius; offset += 1) {
        const glyph = offset === 0 ? "┃" : "│";
        const color = offset === 0 ? "text" : "accent";
        placeCentered(lines, centerRow + offset, safeWidth, this.theme.fg(color, glyph), 1);
      }
    }

    if (progress >= 0.14 && progress < 0.58) {
      const railProgress = clamp((progress - 0.14) / 0.36);
      const railWidth = Math.max(1, Math.floor(railProgress * Math.min(safeWidth - 4, LOGO[0].length + 12)));
      const rail = "━".repeat(railWidth);
      placeCentered(lines, centerRow, safeWidth, this.theme.fg("accent", rail), railWidth);
    }

    if (progress >= 0.24) {
      const reveal = clamp((progress - 0.24) / 0.34);
      const sweep = clamp((progress - 0.42) / 0.28);
      const logoStart = centerRow - Math.floor(LOGO.length / 2);

      LOGO.forEach((line, index) => {
        placeCentered(
          lines,
          logoStart + index,
          safeWidth,
          styleLogoLine(line, reveal, sweep, fading, this.theme),
          line.length,
        );
      });
    }

    if (progress >= 0.64) {
      const label = progress < 0.82 ? "INITIALIZING" : "PI · READY";
      const color = fading ? "dim" : "muted";
      placeCentered(lines, centerRow + Math.floor(LOGO.length / 2) + 2, safeWidth, this.theme.fg(color, label), label.length);
    }

    return lines;
  }

  invalidate(): void {
    // Rendering is derived from the live theme and clock; no cache to clear.
  }

  dispose(): void {
    this.clearTimers();
  }

  private elapsed(): number {
    if (this.startedAt === null) return 0;
    return Math.max(0, this.scheduler.now() - this.startedAt);
  }

  private progress(): number {
    return clamp(this.elapsed() / INTRO_TRANSITION_MS);
  }

  private tick(): void {
    if (!this.holding) this.host.requestRender();
  }

  private beginHold(): void {
    if (this.finished || this.holding) return;

    this.holding = true;
    this.clearAnimationTimer();
    this.host.requestRender();
    this.holdTimer = this.scheduler.setTimeout(() => {
      this.holdTimer = undefined;
      this.finish();
    }, INTRO_HOLD_MS);
  }

  private finish(): void {
    if (this.finished) return;

    this.finished = true;
    this.clearTimers();
    this.onDone();
  }

  private clearTimers(): void {
    this.clearAnimationTimer();
    if (this.transitionTimer !== undefined) {
      this.scheduler.clearTimeout(this.transitionTimer);
      this.transitionTimer = undefined;
    }
    if (this.holdTimer !== undefined) {
      this.scheduler.clearTimeout(this.holdTimer);
      this.holdTimer = undefined;
    }
  }

  private clearAnimationTimer(): void {
    if (this.animationTimer === undefined) return;

    this.scheduler.clearInterval(this.animationTimer);
    this.animationTimer = undefined;
  }
}
