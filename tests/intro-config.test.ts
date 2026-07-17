import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  configToStyle,
  loadIntroConfig,
  saveIntroConfig,
  styleToConfig,
} from "../intro-config.ts";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "pi-intro-test-"));
}

test("loadIntroConfig returns {} for a missing file", () => {
  const dir = tempDir();
  try {
    assert.deepEqual(loadIntroConfig(join(dir, "nope.json")), {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadIntroConfig returns {} for invalid JSON", () => {
  const dir = tempDir();
  try {
    const path = join(dir, "bad.json");
    writeFileSync(path, "not json{", "utf-8");
    assert.deepEqual(loadIntroConfig(path), {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("saveIntroConfig writes and loadIntroConfig reads back", () => {
  const dir = tempDir();
  try {
    const path = join(dir, "nested", "pi-intro.json");
    const config = { word: "SHOPIFY", color: "#95bf47", tagline: "W E L C O M E   B A C K" };
    saveIntroConfig(config, path);
    assert.deepEqual(loadIntroConfig(path), config);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("styleToConfig and configToStyle round-trip", () => {
  const style = { word: "HACKER MODE", hex: "#00dc41", tagline: "W E L C O M E   B A C K" };
  const config = styleToConfig(style);
  assert.deepEqual(config, { word: "HACKER MODE", color: "#00dc41", tagline: "W E L C O M E   B A C K" });
  assert.deepEqual(configToStyle(config), style);
});

test("configToStyle lets config win over base and keeps base for missing keys", () => {
  const base = { word: "PI", hex: "#aaaaaa", tagline: "OLD" };
  const merged = configToStyle({ word: "BEAST MODE" }, base);
  assert.deepEqual(merged, { word: "BEAST MODE", hex: "#aaaaaa", tagline: "OLD" });
});

test("styleToConfig omits undefined fields", () => {
  assert.deepEqual(styleToConfig({}), {});
  assert.deepEqual(styleToConfig({ word: "PI" }), { word: "PI" });
});

test("saved file is human-readable JSON", () => {
  const dir = tempDir();
  try {
    const path = join(dir, "pi-intro.json");
    saveIntroConfig({ word: "WINTER IS COMING", color: "#7fd4ff" }, path);
    const raw = readFileSync(path, "utf-8");
    assert.ok(raw.includes('"word": "WINTER IS COMING"'));
    assert.ok(raw.endsWith("\n"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
