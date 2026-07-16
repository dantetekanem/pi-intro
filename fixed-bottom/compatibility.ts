import {
  CURSOR_MARKER,
  type CursorWidthSemantics,
  type FixedBottomRenderable,
  type FixedBottomTui,
} from "./contracts.ts";

export const EXPECTED_ROOT_CHILDREN = 9;

export interface FixedBottomPreflightInput {
  readonly tui: FixedBottomTui;
  readonly semantics: CursorWidthSemantics;
}

export interface FixedBottomCompatibility {
  readonly tui: FixedBottomTui;
  readonly terminalRowsDescriptor: PropertyDescriptor;
  readonly rootChildren: readonly FixedBottomRenderable[];
}

export type FixedBottomPreflightResult =
  | { readonly ok: true; readonly compatibility: FixedBottomCompatibility }
  | { readonly ok: false; readonly reason: string };

export function findPropertyDescriptor(
  target: object,
  property: PropertyKey,
): PropertyDescriptor | undefined {
  let current: object | null = target;
  while (current) {
    const descriptor = Object.getOwnPropertyDescriptor(current, property);
    if (descriptor) return descriptor;
    current = Object.getPrototypeOf(current) as object | null;
  }
  return undefined;
}

function finiteDimension(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 1;
}

function canShadow(target: object, property: PropertyKey): boolean {
  const own = Object.getOwnPropertyDescriptor(target, property);
  return own ? own.configurable === true : Object.isExtensible(target);
}

function hasMethod(target: object, property: PropertyKey): boolean {
  return typeof (target as Record<PropertyKey, unknown>)[property] === "function";
}

function writableOwnField(target: object, property: PropertyKey): boolean {
  const descriptor = Object.getOwnPropertyDescriptor(target, property);
  return descriptor?.writable === true;
}

function renderable(value: unknown): value is FixedBottomRenderable {
  return typeof value === "object"
    && value !== null
    && typeof (value as { render?: unknown }).render === "function";
}

export function preflightFixedBottomCompositor(
  input: FixedBottomPreflightInput,
): FixedBottomPreflightResult {
  const { tui, semantics } = input;
  if (!tui || typeof tui !== "object") {
    return { ok: false, reason: "TUI instance is missing" };
  }

  const terminal = tui.terminal;
  if (!terminal || typeof terminal !== "object") {
    return { ok: false, reason: "terminal instance is missing" };
  }

  if (!finiteDimension(terminal.columns) || !finiteDimension(terminal.rows)) {
    return { ok: false, reason: "terminal dimensions must be finite positive numbers" };
  }
  if (!hasMethod(terminal, "write")) {
    return { ok: false, reason: "terminal.write is not callable" };
  }
  for (const method of ["hideCursor", "showCursor"] as const) {
    if (!hasMethod(terminal, method)) {
      return { ok: false, reason: `terminal.${method} is not callable` };
    }
  }

  const rowsDescriptor = findPropertyDescriptor(terminal, "rows");
  if (!rowsDescriptor || typeof rowsDescriptor.get !== "function") {
    return { ok: false, reason: "terminal.rows must be backed by a getter descriptor" };
  }
  if (
    !canShadow(terminal, "rows")
    || !canShadow(terminal, "write")
    || !canShadow(terminal, "hideCursor")
    || !canShadow(terminal, "showCursor")
  ) {
    return { ok: false, reason: "terminal rows/write/cursor properties cannot be patched transactionally" };
  }

  const requiredMethods = [
    "render",
    "doRender",
    "requestRender",
    "addInputListener",
    "hasOverlay",
    "start",
    "stop",
    "compositeOverlays",
    "compositeLineAt",
  ] as const;
  for (const method of requiredMethods) {
    if (!hasMethod(tui, method)) {
      return { ok: false, reason: `TUI.${method} is not callable` };
    }
  }
  for (const method of ["render", "doRender", "start", "stop", "compositeOverlays", "compositeLineAt"] as const) {
    if (!canShadow(tui, method)) {
      return { ok: false, reason: `TUI.${method} cannot be patched transactionally` };
    }
  }
  if (typeof tui.stopped !== "boolean" || !writableOwnField(tui, "stopped")) {
    return { ok: false, reason: "TUI.stopped must be a writable boolean field" };
  }
  if (!Array.isArray(tui.previousLines) || !writableOwnField(tui, "previousLines")) {
    return { ok: false, reason: "TUI.previousLines must be a writable array field" };
  }
  if (
    !(tui.previousKittyImageIds instanceof Set)
    || !writableOwnField(tui, "previousKittyImageIds")
  ) {
    return { ok: false, reason: "TUI.previousKittyImageIds must be a writable Set field" };
  }
  const numericRenderFields = [
    "previousWidth",
    "previousHeight",
    "cursorRow",
    "hardwareCursorRow",
    "maxLinesRendered",
    "previousViewportTop",
    "fullRedrawCount",
  ] as const;
  for (const field of numericRenderFields) {
    if (!Number.isFinite(tui[field]) || !writableOwnField(tui, field)) {
      return { ok: false, reason: `TUI.${field} must be a writable finite render field` };
    }
  }

  if (!Array.isArray(tui.children) || tui.children.length !== EXPECTED_ROOT_CHILDREN) {
    return {
      ok: false,
      reason: `TUI root must contain exactly ${EXPECTED_ROOT_CHILDREN} children`,
    };
  }
  if (!tui.children.every(renderable)) {
    return { ok: false, reason: "all root children must be renderable" };
  }
  if (!tui.children.slice(4).every(renderable)) {
    return { ok: false, reason: "the dynamic last five root children must be renderable" };
  }

  if (
    semantics.cursorMarker !== CURSOR_MARKER
    || typeof semantics.visibleWidth !== "function"
  ) {
    return { ok: false, reason: "public cursor/width semantics do not match the required Pi TUI contract" };
  }
  try {
    if (semantics.visibleWidth(semantics.cursorMarker) !== 0) {
      return { ok: false, reason: "public cursor marker must be zero-width" };
    }
    const sampleWidth = semantics.visibleWidth("A界🙂");
    if (!Number.isFinite(sampleWidth) || sampleWidth < 1) {
      return { ok: false, reason: "public visibleWidth returned an invalid width" };
    }
  } catch {
    return { ok: false, reason: "public visibleWidth failed during preflight" };
  }

  return {
    ok: true,
    compatibility: {
      tui,
      terminalRowsDescriptor: rowsDescriptor,
      rootChildren: tui.children,
    },
  };
}
