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

const TAGLINE = "W E L C O M E   B A C K";

/**
 * 5-row full-block font matching the weight of the PI logo above.
 * Each glyph is 4 columns wide; a one-column gap separates glyphs.
 */
const BLOCK_FONT: Record<string, readonly string[]> = {
  " ": ["    ", "    ", "    ", "    ", "    "],
  "'": ["█   ", "█   ", "    ", "    ", "    "],
  A: ["████", "█  █", "████", "█  █", "█  █"],
  B: ["████", "█  █", "████", "█  █", "████"],
  C: ["████", "█   ", "█   ", "█   ", "████"],
  D: ["███ ", "█  █", "█  █", "█  █", "███ "],
  E: ["████", "█   ", "████", "█   ", "████"],
  F: ["████", "█   ", "████", "█   ", "█   "],
  G: ["████", "█   ", "█ ██", "█  █", "████"],
  H: ["█  █", "█  █", "████", "█  █", "█  █"],
  I: ["████", " ██ ", " ██ ", " ██ ", "████"],
  J: ["████", "   █", "   █", "█  █", "████"],
  K: ["█  █", "█ █ ", "██  ", "█ █ ", "█  █"],
  L: ["█   ", "█   ", "█   ", "█   ", "████"],
  M: ["█  █", "████", "████", "█  █", "█  █"],
  N: ["█  █", "██ █", "█ ██", "█  █", "█  █"],
  O: ["████", "█  █", "█  █", "█  █", "████"],
  P: ["████", "█  █", "████", "█   ", "█   "],
  Q: ["████", "█  █", "█ ██", "█  █", "████"],
  R: ["████", "█  █", "████", "█ █ ", "█  █"],
  S: ["████", "█   ", "████", "   █", "████"],
  T: ["████", " ██ ", " ██ ", " ██ ", " ██ "],
  U: ["█  █", "█  █", "█  █", "█  █", "████"],
  V: ["█  █", "█  █", "█  █", "█  █", " ██ "],
  W: ["█  █", "█  █", "████", "████", "█  █"],
  X: ["█  █", "█  █", " ██ ", "█  █", "█  █"],
  Y: ["█  █", "█  █", " ██ ", " ██ ", " ██ "],
  Z: ["████", "   █", " ██ ", "█   ", "████"],
};

/** Compose a word into block-font banner lines. Unknown characters render as spaces. */
export function composeBlockWord(word: string): string[] {
  const glyphs = Array.from(word.toUpperCase()).map((character) => BLOCK_FONT[character] ?? BLOCK_FONT[" "]);
  const rows = [0, 1, 2, 3, 4].map((row) =>
    glyphs.map((glyph) => glyph[row]).join(" ").trimEnd(),
  );
  // Pad every row to the same width so centering aligns all rows into a
  // clean rectangle (trimmed rows would otherwise center at different offsets).
  const width = Math.max(...rows.map((row) => row.length));
  return rows.map((row) => row.padEnd(width, " "));
}

export interface IntroTheme {
  fg(color: string, text: string): string;
  bold(text: string): string;
}

/**
 * Cosmetic customization for the intro hero. The beam, rail, sweep, and status
 * line always follow the live Pi theme; the style controls the big hero word,
 * its color, and the tagline beneath it.
 */
export interface IntroStyle {
  /** Big hero word (block font). Undefined renders the classic PI logo. */
  word?: string;
  /** 6-digit hex color for the hero word (e.g. "#95bf47"). Omit for the theme accent color. */
  hex?: string;
  /** Tagline rendered under the hero in the theme's muted color. */
  tagline?: string;
}

export const STYLE_PRESETS = {
  pi: {},
  shopify: { word: "SHOPIFY", hex: "#95bf47", tagline: TAGLINE },
  hacker: { word: "HACKER MODE", hex: "#00dc41", tagline: TAGLINE },
  coffee: { word: "COFFEE TIME", hex: "#c08051", tagline: TAGLINE },
  beast: { word: "BEAST MODE", hex: "#e74c3c", tagline: TAGLINE },
  prof: { word: "PROFESSOR", hex: "#f1c40f", tagline: TAGLINE },
  winter: { word: "WINTER IS COMING", hex: "#7fd4ff", tagline: TAGLINE },
} as const satisfies Record<string, IntroStyle>;

export type IntroStyleName = keyof typeof STYLE_PRESETS;

export const DEFAULT_STYLE: IntroStyle = STYLE_PRESETS.pi;

function isValidHex(hex: string): boolean {
  return /^#?[0-9a-fA-F]{6}$/.test(hex.trim());
}

/**
 * Resolve a user-supplied style (preset name or partial object). Unknown names
 * fall back to DEFAULT_STYLE; invalid hex values are dropped (theme accent).
 * Returns DEFAULT_STYLE itself when nothing customizes the intro.
 */
export function resolveIntroStyle(style?: IntroStyle | string): IntroStyle {
  const base = typeof style === "string"
    ? STYLE_PRESETS[style as IntroStyleName] ?? DEFAULT_STYLE
    : style ?? DEFAULT_STYLE;
  const resolved: IntroStyle = { ...base };
  if (resolved.hex !== undefined && !isValidHex(resolved.hex)) delete resolved.hex;
  return Object.keys(resolved).length === 0 ? DEFAULT_STYLE : resolved;
}

function hexToAnsiFg(hex: string): string | undefined {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!match) return undefined;

  const value = Number.parseInt(match[1], 16);
  const red = (value >> 16) & 0xff;
  const green = (value >> 8) & 0xff;
  const blue = value & 0xff;
  return `\x1b[38;2;${red};${green};${blue}m`;
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
  style?: IntroStyle;
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
  brand?: string,
): string {
  const characters = Array.from(line);
  const center = (characters.length - 1) / 2;
  const radius = reveal * (characters.length / 2 + 1);
  const sweepColumn = sweep * Math.max(0, characters.length - 1);

  return characters.map((character, index) => {
    if (Math.abs(index - center) > radius || character === " ") return " ";

    if (fading) return theme.bold(theme.fg("dim", character));
    if (Math.abs(index - sweepColumn) < 1.25) return theme.bold(theme.fg("text", character));
    if (brand !== undefined) return theme.bold(`${brand}${character}\x1b[39m`);
    return theme.bold(theme.fg("accent", character));
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
  private readonly heroLines: readonly string[];
  private readonly brand?: string;
  private readonly tagline?: string;
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

    const style = options.style ?? DEFAULT_STYLE;
    this.heroLines = style.word === undefined ? LOGO : composeBlockWord(style.word);
    this.brand = style.hex === undefined ? undefined : hexToAnsiFg(style.hex);
    this.tagline = style.tagline;
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
      const compact = progress < 0.16 ? "·" : this.tagline === undefined ? "PI" : "·";
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
      const logoStart = centerRow - Math.floor(this.heroLines.length / 2);

      this.heroLines.forEach((line, index) => {
        placeCentered(
          lines,
          logoStart + index,
          safeWidth,
          styleLogoLine(line, reveal, sweep, fading, this.theme, this.brand),
          line.length,
        );
      });
    }

    if (progress >= 0.64) {
      const label = progress < 0.82 ? "INITIALIZING" : "PI · READY";
      const color = fading ? "dim" : "muted";
      placeCentered(lines, centerRow + Math.floor(LOGO.length / 2) + 2, safeWidth, this.theme.fg(color, label), label.length);
    }

    if (progress >= 0.64 && this.tagline !== undefined) {
      const color = fading ? "dim" : "muted";
      const taglineRow = centerRow + Math.floor(this.heroLines.length / 2) + 3;
      placeCentered(lines, taglineRow, safeWidth, this.theme.fg(color, this.tagline), this.tagline.length);
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
