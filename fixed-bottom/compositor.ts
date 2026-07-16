import { layoutFixedBottomCluster } from "./cluster-layout.ts";
import {
  preflightFixedBottomCompositor,
  type FixedBottomCompatibility,
} from "./compatibility.ts";
import type {
  CursorWidthSemantics,
  FixedBottomCluster,
  FixedBottomInputListener,
  FixedBottomTerminal,
  FixedBottomTui,
  ProcessExitTarget,
  ViewportState,
} from "./contracts.ts";
import { createFixedBottomInputListener } from "./input.ts";
import {
  collectKittyImageIds,
  deleteKittyImage,
  deleteKittyImages,
  paintFixedBottomCluster,
  type KittyImageDelete,
} from "./paint.ts";
import {
  enterFixedBottomMode,
  restoreTerminalModes,
  suspendFixedBottomScrollRegion,
  updateFixedBottomScrollRegion,
} from "./terminal-modes.ts";
import { renderFixedBottomTopology } from "./topology.ts";
import {
  createViewportState,
  followViewportBottom,
  sliceViewport,
  updateViewport,
} from "./viewport.ts";

export interface InstallFixedBottomCompositorOptions {
  readonly tui: FixedBottomTui;
  readonly runtimeVersion: string;
  readonly semantics: CursorWidthSemantics;
  readonly processTarget?: ProcessExitTarget;
  readonly deleteKittyImage?: KittyImageDelete;
}

export interface FixedBottomCompositor {
  readonly disposed: boolean;
  jumpToBottom(): void;
  requestRepaint(): void;
  dispose(): void;
}

export type InstallFixedBottomCompositorResult =
  | { readonly installed: true; readonly compositor: FixedBottomCompositor }
  | { readonly installed: false; readonly reason: string };

interface ModeState {
  readonly active: boolean;
  readonly scrollBottom: number | null;
}

interface ModePlan {
  readonly sequence: string;
  readonly next: ModeState;
}

interface FixedRenderPass {
  readonly kind: "fixed";
  readonly realRows: number;
  readonly scrollRows: number;
  readonly cluster: FixedBottomCluster;
  readonly transcriptLines: readonly string[];
  readonly nextViewport: ViewportState;
}

interface OverlayRenderPass {
  readonly kind: "overlay";
  readonly realRows: number;
}

type RenderPass = FixedRenderPass | OverlayRenderPass;
type RenderSurface = RenderPass["kind"] | null;

interface FixedGeometry {
  readonly realRows: number;
  readonly startRow: number;
  readonly endRow: number;
}

interface TuiRenderStateSnapshot {
  readonly previousLines: readonly string[];
  readonly previousKittyImageIds: ReadonlySet<number>;
  readonly previousWidth: number;
  readonly previousHeight: number;
  readonly cursorRow: number;
  readonly hardwareCursorRow: number;
  readonly maxLinesRendered: number;
  readonly previousViewportTop: number;
  readonly fullRedrawCount: number;
}

interface PropertyPatch {
  restore(): void;
}

const SYNCHRONIZED_OUTPUT_ON = "\x1b[?2026h";
const SYNCHRONIZED_OUTPUT_OFF = "\x1b[?2026l";
const SAFE_SCREEN_ORIGIN = "\x1b[1;1H";
const FORBIDDEN_FULL_REDRAW_SEQUENCES = ["\x1b[2J", "\x1b[H", "\x1b[3J"] as const;

function coordinatedOutput(output: string): string {
  const body = output
    .split(SYNCHRONIZED_OUTPUT_ON).join("")
    .split(SYNCHRONIZED_OUTPUT_OFF).join("");
  return body ? `${SYNCHRONIZED_OUTPUT_ON}${body}${SYNCHRONIZED_OUTPUT_OFF}` : "";
}

function rejectFullRedrawSequences(output: string): void {
  const forbidden = FORBIDDEN_FULL_REDRAW_SEQUENCES.find((sequence) => output.includes(sequence));
  if (forbidden) {
    throw new Error(`fixed-bottom compositor rejected Pi full redraw sequence ${JSON.stringify(forbidden)}`);
  }
}

function patchProperty(
  target: object,
  property: PropertyKey,
  descriptor: PropertyDescriptor,
): PropertyPatch {
  const previous = Object.getOwnPropertyDescriptor(target, property);
  Object.defineProperty(target, property, descriptor);
  let restored = false;

  return {
    restore(): void {
      if (restored) return;
      restored = true;
      if (previous) Object.defineProperty(target, property, previous);
      else delete (target as Record<PropertyKey, unknown>)[property];
    },
  };
}

function fixedModePlan(state: ModeState, scrollBottom: number): ModePlan {
  if (!state.active) {
    return {
      sequence: enterFixedBottomMode(scrollBottom),
      next: { active: true, scrollBottom },
    };
  }
  if (state.scrollBottom === scrollBottom) {
    return { sequence: "", next: state };
  }
  return {
    sequence: updateFixedBottomScrollRegion(scrollBottom),
    next: { active: true, scrollBottom },
  };
}

function overlayModePlan(state: ModeState, realRows: number): ModePlan {
  if (!state.active) {
    return {
      sequence: enterFixedBottomMode(realRows),
      next: { active: true, scrollBottom: null },
    };
  }
  if (state.scrollBottom === null) return { sequence: "", next: state };
  return {
    sequence: suspendFixedBottomScrollRegion(),
    next: { active: true, scrollBottom: null },
  };
}

function restoredModePlan(state: ModeState): ModePlan {
  if (!state.active) return { sequence: "", next: state };
  return {
    sequence: restoreTerminalModes(),
    next: { active: false, scrollBottom: null },
  };
}

function removedKittyImageIds(
  previous: ReadonlySet<number>,
  current: ReadonlySet<number>,
): ReadonlySet<number> {
  const removed = new Set<number>();
  for (const imageId of previous) {
    if (!current.has(imageId)) removed.add(imageId);
  }
  return removed;
}

function unionImageIds(...sets: readonly ReadonlySet<number>[]): ReadonlySet<number> {
  const result = new Set<number>();
  for (const ids of sets) {
    for (const id of ids) result.add(id);
  }
  return result;
}

function showHardwareCursor(tui: FixedBottomTui): boolean {
  return typeof tui.getShowHardwareCursor === "function"
    ? tui.getShowHardwareCursor()
    : false;
}

function snapshotTuiRenderState(tui: FixedBottomTui): TuiRenderStateSnapshot {
  return {
    previousLines: [...tui.previousLines],
    previousKittyImageIds: new Set(tui.previousKittyImageIds),
    previousWidth: tui.previousWidth,
    previousHeight: tui.previousHeight,
    cursorRow: tui.cursorRow,
    hardwareCursorRow: tui.hardwareCursorRow,
    maxLinesRendered: tui.maxLinesRendered,
    previousViewportTop: tui.previousViewportTop,
    fullRedrawCount: tui.fullRedrawCount,
  };
}

function restoreTuiRenderState(tui: FixedBottomTui, snapshot: TuiRenderStateSnapshot): void {
  tui.previousLines = [...snapshot.previousLines];
  tui.previousKittyImageIds = new Set(snapshot.previousKittyImageIds);
  tui.previousWidth = snapshot.previousWidth;
  tui.previousHeight = snapshot.previousHeight;
  tui.cursorRow = snapshot.cursorRow;
  tui.hardwareCursorRow = snapshot.hardwareCursorRow;
  tui.maxLinesRendered = snapshot.maxLinesRendered;
  tui.previousViewportTop = snapshot.previousViewportTop;
  tui.fullRedrawCount = snapshot.fullRedrawCount;
}

function fixedGeometry(realRows: number, lineCount: number): FixedGeometry | null {
  const endRow = Math.max(1, Math.floor(realRows));
  const rows = Math.max(0, Math.min(Math.floor(lineCount), endRow));
  if (rows === 0) return null;
  return {
    realRows: endRow,
    startRow: endRow - rows + 1,
    endRow,
  };
}

function sameGeometry(left: FixedGeometry | null, right: FixedGeometry | null): boolean {
  return left?.realRows === right?.realRows
    && left?.startRow === right?.startRow
    && left?.endRow === right?.endRow;
}

function clearGeometryRows(...geometries: readonly (FixedGeometry | null)[]): string {
  const rows = new Set<number>();
  for (const geometry of geometries) {
    if (!geometry) continue;
    for (let row = geometry.startRow; row <= geometry.endRow; row += 1) rows.add(row);
  }

  let output = "";
  for (const row of [...rows].sort((left, right) => left - right)) {
    output += `\x1b[${row};1H\x1b[2K`;
  }
  return output;
}

class InstalledFixedBottomCompositor implements FixedBottomCompositor {
  private readonly tui: FixedBottomTui;
  private readonly terminal: FixedBottomTerminal;
  private readonly compatibility: FixedBottomCompatibility;
  private readonly semantics: CursorWidthSemantics;
  private readonly processTarget: ProcessExitTarget;
  private readonly deleteImage: KittyImageDelete;
  private readonly originalRender: FixedBottomTui["render"];
  private readonly originalDoRender: FixedBottomTui["doRender"];
  private readonly originalCompositeLineAt: FixedBottomTui["compositeLineAt"];
  private readonly originalWrite: FixedBottomTerminal["write"];
  private readonly initialTuiState: TuiRenderStateSnapshot;
  private readonly patches: PropertyPatch[] = [];

  private viewport: ViewportState = createViewportState();
  private mode: ModeState = { active: false, scrollBottom: null };
  private surface: RenderSurface = null;
  private currentPass: RenderPass | null = null;
  private capturedWrites: string[] | null = null;
  private reportedRows: number;
  private stagedReportedRows: number | null = null;
  private previousRealRows: number;
  private previousTerminalColumns: number;
  private previousGeometry: FixedGeometry | null = null;
  private previousClusterLines: readonly string[] = [];
  private previousClusterImageIds: ReadonlySet<number> = new Set();
  private transactionOutputMayHaveApplied = false;
  private transactionModeMayBeActive = false;
  private transactionModeRestoreAttempted = false;
  private transactionClusterImageIds: ReadonlySet<number> = new Set();
  private transactionGeometries: readonly (FixedGeometry | null)[] = [];
  private removeInputListener: (() => void) | null = null;
  private exitRegistered = false;
  private installComplete = false;
  private disposing = false;
  private isDisposed = false;

  private readonly exitHandler = (): void => {
    this.disposeInternal(false);
  };

  constructor(
    options: InstallFixedBottomCompositorOptions,
    compatibility: FixedBottomCompatibility,
  ) {
    this.tui = options.tui;
    this.terminal = options.tui.terminal;
    this.compatibility = compatibility;
    this.semantics = options.semantics;
    this.processTarget = options.processTarget ?? process;
    this.deleteImage = options.deleteKittyImage ?? deleteKittyImage;
    this.originalRender = this.tui.render;
    this.originalDoRender = this.tui.doRender;
    this.originalCompositeLineAt = this.tui.compositeLineAt;
    this.originalWrite = this.terminal.write;
    this.initialTuiState = snapshotTuiRenderState(this.tui);
    this.reportedRows = this.readRealRows();
    this.previousRealRows = this.reportedRows;
    this.previousTerminalColumns = this.terminal.columns;
  }

  get disposed(): boolean {
    return this.isDisposed;
  }

  install(): void {
    const inputListener = createFixedBottomInputListener({
      getState: () => this.viewport,
      setState: (state) => {
        this.viewport = state;
      },
      getVisibleRows: () => this.reportedRows,
      isSuspended: () => this.tui.hasOverlay(),
      requestRender: () => this.tui.requestRender(),
    });

    try {
      this.applyPatches();
      this.removeInputListener = this.tui.addInputListener(inputListener as FixedBottomInputListener);
      this.exitRegistered = true;
      this.processTarget.once("exit", this.exitHandler);
      this.render();
      this.installComplete = true;
    } catch (error) {
      this.rollbackInstall();
      throw error;
    }
  }

  jumpToBottom(): void {
    if (this.isDisposed || this.disposing) return;
    this.viewport = followViewportBottom(this.viewport, this.reportedRows).state;
    this.tui.requestRender();
  }

  requestRepaint(): void {
    if (this.isDisposed || this.disposing) return;
    this.tui.requestRender();
  }

  dispose(): void {
    this.disposeInternal(true);
  }

  private readRealRows(): number {
    return this.compatibility.terminalRowsDescriptor.get!.call(this.terminal) as number;
  }

  private bestEffortRealRows(): number {
    try {
      return this.readRealRows();
    } catch {
      return this.previousRealRows;
    }
  }

  private applyPatches(): void {
    const terminal = this.terminal;
    const tui = this.tui;

    this.patches.push(patchProperty(terminal, "rows", {
      configurable: true,
      enumerable: false,
      get: () => this.stagedReportedRows ?? this.reportedRows,
    }));
    this.patches.push(patchProperty(terminal, "write", {
      configurable: true,
      enumerable: false,
      writable: true,
      value: (data: string): void => {
        if (this.capturedWrites) this.capturedWrites.push(data);
        else this.originalWrite.call(terminal, data);
      },
    }));
    this.patches.push(patchProperty(tui, "render", {
      configurable: true,
      enumerable: false,
      writable: true,
      value: (width: number): string[] => {
        if (this.currentPass?.kind === "fixed") {
          return [...this.currentPass.transcriptLines];
        }
        return this.originalRender.call(tui, width);
      },
    }));
    this.patches.push(patchProperty(tui, "doRender", {
      configurable: true,
      enumerable: false,
      writable: true,
      value: (): void => this.render(),
    }));
    this.patches.push(patchProperty(tui, "compositeLineAt", {
      configurable: true,
      enumerable: false,
      writable: true,
      value: (
        baseLine: string,
        overlayLine: string,
        startCol: number,
        overlayWidth: number,
        totalWidth: number,
      ): string => this.originalCompositeLineAt.call(
        tui,
        baseLine,
        overlayLine,
        startCol,
        overlayWidth,
        totalWidth,
      ),
    }));
  }

  private buildFixedPass(realRows: number): FixedRenderPass {
    const width = Math.max(1, Math.floor(this.terminal.columns));
    const topology = renderFixedBottomTopology(this.tui.children, width);
    const cluster = layoutFixedBottomCluster({
      width,
      terminalRows: realRows,
      ...topology.clusterInput,
    }, this.semantics);
    const scrollRows = Math.max(1, realRows - cluster.lines.length);
    const viewport = updateViewport(
      this.viewport,
      topology.transcriptLines.length,
      scrollRows,
    );

    return {
      kind: "fixed",
      realRows,
      scrollRows,
      cluster,
      transcriptLines: sliceViewport(topology.transcriptLines, viewport.window),
      nextViewport: viewport.state,
    };
  }

  private render(): void {
    if (this.isDisposed || this.disposing) return;

    const preTransactionState = snapshotTuiRenderState(this.tui);
    let pass: RenderPass | null = null;
    try {
      const realRows = this.readRealRows();
      pass = this.tui.hasOverlay()
        ? { kind: "overlay", realRows }
        : this.buildFixedPass(realRows);
      this.performRenderPass(pass);
    } catch (error) {
      restoreTuiRenderState(this.tui, preTransactionState);
      this.resetTransientRenderState();
      if (!this.installComplete) throw error;
      this.enterFailClosed(preTransactionState, pass);
    }
  }

  private performRenderPass(pass: RenderPass): void {
    if (pass.kind === "fixed") this.renderFixed(pass);
    else this.renderOverlay(pass);
  }

  private shouldResetDifferential(pass: RenderPass, geometry: FixedGeometry | null): boolean {
    const targetRows = pass.kind === "fixed" ? pass.scrollRows : pass.realRows;
    return this.surface !== pass.kind
      || this.previousRealRows !== pass.realRows
      || this.previousTerminalColumns !== this.terminal.columns
      || this.reportedRows !== targetRows
      || (pass.kind === "fixed" && !sameGeometry(this.previousGeometry, geometry));
  }

  private stageTuiRenderState(pass: RenderPass, resetDifferential: boolean): void {
    const targetRows = pass.kind === "fixed" ? pass.scrollRows : pass.realRows;
    if (resetDifferential) {
      this.tui.previousLines = [];
      this.tui.previousKittyImageIds = new Set();
      this.tui.cursorRow = 0;
    }
    this.tui.previousWidth = this.terminal.columns;
    this.tui.previousHeight = targetRows;
    this.tui.maxLinesRendered = 0;
    if (pass.kind === "fixed" || resetDifferential) {
      this.tui.previousViewportTop = 0;
      this.tui.hardwareCursorRow = 0;
    }
    this.stagedReportedRows = targetRows;
    this.currentPass = pass;
  }

  private renderFixed(pass: FixedRenderPass): void {
    const modePlan = fixedModePlan(this.mode, pass.scrollRows);
    const geometry = fixedGeometry(pass.realRows, pass.cluster.lines.length);
    const resetDifferential = this.shouldResetDifferential(pass, geometry);
    const currentClusterImageIds = collectKittyImageIds(pass.cluster.lines);
    const removedImageIds = removedKittyImageIds(
      this.previousClusterImageIds,
      currentClusterImageIds,
    );

    this.stageTuiRenderState(pass, resetDifferential);
    this.transactionModeMayBeActive = modePlan.next.active;
    this.transactionModeRestoreAttempted = this.mode.active && !modePlan.next.active;
    this.transactionClusterImageIds = currentClusterImageIds;
    this.transactionGeometries = [this.previousGeometry, geometry];

    const geometryClear = this.surface === "fixed" && sameGeometry(this.previousGeometry, geometry)
      ? ""
      : clearGeometryRows(this.previousGeometry, geometry);
    const prefix = modePlan.sequence
      + deleteKittyImages(removedImageIds, this.deleteImage)
      + geometryClear
      + SAFE_SCREEN_ORIGIN;
    const suffix = paintFixedBottomCluster({
      cluster: pass.cluster,
      terminalRows: pass.realRows,
      showHardwareCursor: showHardwareCursor(this.tui),
    });

    this.flushRenderTransaction(prefix, suffix);

    this.mode = modePlan.next;
    this.reportedRows = pass.scrollRows;
    this.stagedReportedRows = null;
    this.viewport = pass.nextViewport;
    this.previousRealRows = pass.realRows;
    this.previousTerminalColumns = this.terminal.columns;
    this.previousGeometry = geometry;
    this.previousClusterLines = [...pass.cluster.lines];
    this.previousClusterImageIds = currentClusterImageIds;
    this.surface = "fixed";
    this.synchronizeHardwareCursor(pass);
    this.completeRenderTransaction();
  }

  private synchronizeHardwareCursor(pass: FixedRenderPass): void {
    const clusterStartRow = pass.realRows - pass.cluster.lines.length;
    this.tui.hardwareCursorRow = pass.cluster.cursor
      ? clusterStartRow + pass.cluster.cursor.row
      : pass.realRows - 1;
  }

  private renderOverlay(pass: OverlayRenderPass, restoreModes = false): void {
    const modePlan = restoreModes
      ? restoredModePlan(this.mode)
      : overlayModePlan(this.mode, pass.realRows);
    const projectedGeometry = fixedGeometry(pass.realRows, this.previousClusterLines.length);
    const resetDifferential = this.shouldResetDifferential(pass, null);

    this.stageTuiRenderState(pass, resetDifferential);
    this.transactionModeMayBeActive = modePlan.next.active;
    this.transactionModeRestoreAttempted = this.mode.active && !modePlan.next.active;
    this.transactionClusterImageIds = new Set();
    this.transactionGeometries = [this.previousGeometry, projectedGeometry];

    const prefix = modePlan.sequence
      + deleteKittyImages(this.previousClusterImageIds, this.deleteImage)
      + clearGeometryRows(this.previousGeometry, projectedGeometry)
      + (resetDifferential ? SAFE_SCREEN_ORIGIN : "");

    this.flushRenderTransaction(prefix, "");

    this.mode = modePlan.next;
    this.reportedRows = pass.realRows;
    this.stagedReportedRows = null;
    this.previousRealRows = pass.realRows;
    this.previousTerminalColumns = this.terminal.columns;
    this.previousGeometry = null;
    this.previousClusterLines = [];
    this.previousClusterImageIds = new Set();
    this.surface = "overlay";
    this.completeRenderTransaction();
  }

  private flushRenderTransaction(prefix: string, suffix: string): void {
    if (this.capturedWrites) {
      throw new Error("fixed-bottom render transaction is already active");
    }

    this.capturedWrites = [];
    try {
      this.originalDoRender.call(this.tui);
      const output = coordinatedOutput(prefix + this.capturedWrites.join("") + suffix);
      rejectFullRedrawSequences(output);
      this.capturedWrites = null;
      this.currentPass = null;
      if (output) {
        this.transactionOutputMayHaveApplied = true;
        this.originalWrite.call(this.terminal, output);
      }
    } finally {
      this.capturedWrites = null;
      this.currentPass = null;
    }
  }

  private completeRenderTransaction(): void {
    this.transactionOutputMayHaveApplied = false;
    this.transactionModeMayBeActive = false;
    this.transactionModeRestoreAttempted = false;
    this.transactionClusterImageIds = new Set();
    this.transactionGeometries = [];
  }

  private resetTransientRenderState(): void {
    this.stagedReportedRows = null;
    this.currentPass = null;
    this.capturedWrites = null;
  }

  private writePhysical(output: string): void {
    const coordinated = coordinatedOutput(output);
    if (!coordinated) return;
    rejectFullRedrawSequences(coordinated);
    this.originalWrite.call(this.terminal, coordinated);
  }

  private cleanupOutput(pass: RenderPass | null): string {
    const realRows = pass?.realRows ?? this.bestEffortRealRows();
    const projectedGeometry = fixedGeometry(realRows, this.previousClusterLines.length);
    const imageIds = this.transactionOutputMayHaveApplied
      ? unionImageIds(this.previousClusterImageIds, this.transactionClusterImageIds)
      : this.previousClusterImageIds;
    const restoreAlreadyAttempted = this.transactionOutputMayHaveApplied
      && this.transactionModeRestoreAttempted;
    const restore = !restoreAlreadyAttempted
      && (
        this.mode.active
        || (this.transactionOutputMayHaveApplied && this.transactionModeMayBeActive)
      )
      ? restoreTerminalModes()
      : "";

    const pendingGeometries = this.transactionOutputMayHaveApplied
      ? this.transactionGeometries
      : [];
    return restore
      + deleteKittyImages(imageIds, this.deleteImage)
      + clearGeometryRows(
        this.previousGeometry,
        projectedGeometry,
        ...pendingGeometries,
      );
  }

  private rollbackInstall(): void {
    this.removeRegisteredHooks();
    try {
      this.writePhysical(this.cleanupOutput(null));
    } catch {
      // The original write may be the installation failure source.
    }

    this.restorePatches();
    restoreTuiRenderState(this.tui, this.initialTuiState);
    this.resetOwnedState();
    this.isDisposed = true;
  }

  private enterFailClosed(
    preTransactionState: TuiRenderStateSnapshot,
    pass: RenderPass | null,
  ): void {
    this.disposing = true;
    this.removeRegisteredHooks();
    try {
      this.writePhysical(this.cleanupOutput(pass));
    } catch {
      // Fail-closed cleanup is best-effort when the terminal itself is failing.
    }

    this.restorePatches();
    restoreTuiRenderState(this.tui, preTransactionState);
    this.resetOwnedState();
    this.isDisposed = true;
    this.disposing = false;
  }

  private removeRegisteredHooks(): void {
    const removeInput = this.removeInputListener;
    this.removeInputListener = null;
    try {
      removeInput?.();
    } catch {
      // Continue so the exit hook is always given its cleanup attempt.
    }

    if (this.exitRegistered) {
      this.exitRegistered = false;
      try {
        this.processTarget.removeListener("exit", this.exitHandler);
      } catch {
        // Hook cleanup is best-effort; descriptor restoration must still run.
      }
    }
  }

  private restorePatches(): void {
    for (const patch of this.patches.reverse()) {
      try {
        patch.restore();
      } catch {
        // Keep restoring later patches even if a host descriptor changed concurrently.
      }
    }
    this.patches.length = 0;
  }

  private resetOwnedState(): void {
    this.mode = { active: false, scrollBottom: null };
    this.surface = null;
    this.previousGeometry = null;
    this.previousClusterLines = [];
    this.previousClusterImageIds = new Set();
    this.transactionOutputMayHaveApplied = false;
    this.transactionModeMayBeActive = false;
    this.transactionModeRestoreAttempted = false;
    this.transactionClusterImageIds = new Set();
    this.transactionGeometries = [];
    this.resetTransientRenderState();
  }

  private disposeInternal(renderRoot: boolean): void {
    if (this.isDisposed || this.disposing) return;
    this.disposing = true;
    const preTransactionState = snapshotTuiRenderState(this.tui);
    this.removeRegisteredHooks();

    try {
      if (renderRoot) {
        const pass: OverlayRenderPass = {
          kind: "overlay",
          realRows: this.readRealRows(),
        };
        this.renderOverlay(pass, true);
      } else {
        this.writePhysical(this.cleanupOutput(null));
        this.mode = { active: false, scrollBottom: null };
        this.previousGeometry = null;
        this.previousClusterLines = [];
        this.previousClusterImageIds = new Set();
      }
    } catch {
      restoreTuiRenderState(this.tui, preTransactionState);
      this.resetTransientRenderState();
      this.enterFailClosed(preTransactionState, null);
      return;
    }

    this.restorePatches();
    this.resetOwnedState();
    this.isDisposed = true;
    this.disposing = false;
  }
}

export function installFixedBottomCompositor(
  options: InstallFixedBottomCompositorOptions,
): InstallFixedBottomCompositorResult {
  const preflight = preflightFixedBottomCompositor(options);
  if (!preflight.ok) return { installed: false, reason: preflight.reason };

  const compositor = new InstalledFixedBottomCompositor(
    options,
    preflight.compatibility,
  );
  try {
    compositor.install();
    return { installed: true, compositor };
  } catch (error) {
    return {
      installed: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
