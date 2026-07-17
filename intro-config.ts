import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { IntroStyle } from "./intro-component.ts";

export interface IntroConfig {
  word?: string;
  color?: string;
  tagline?: string;
}

const CONFIG_FILE = "pi-intro.json";

function defaultConfigPath(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? ".";
  return join(home, ".pi", "agent", CONFIG_FILE);
}

/** Load the persisted intro config. Returns {} on any error (missing file, bad JSON). */
export function loadIntroConfig(path = defaultConfigPath()): IntroConfig {
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as IntroConfig;
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

/** Persist the intro config. Creates the directory if needed. */
export function saveIntroConfig(config: IntroConfig, path = defaultConfigPath()): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
}

/** Merge a persisted config into a style; config wins over the given base. */
export function configToStyle(config: IntroConfig, base: IntroStyle = {}): IntroStyle {
  return {
    ...base,
    ...(config.word === undefined ? {} : { word: config.word }),
    ...(config.color === undefined ? {} : { hex: config.color }),
    ...(config.tagline === undefined ? {} : { tagline: config.tagline }),
  };
}

/** Extract the persistable fields from a resolved style. */
export function styleToConfig(style: IntroStyle): IntroConfig {
  const config: IntroConfig = {};
  if (style.word !== undefined) config.word = style.word;
  if (style.hex !== undefined) config.color = style.hex;
  if (style.tagline !== undefined) config.tagline = style.tagline;
  return config;
}
