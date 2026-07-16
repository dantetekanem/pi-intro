import assert from "node:assert/strict";
import test from "node:test";
import {
  INTRO_DURATION_MS,
  INTRO_HOLD_MS,
  INTRO_TRANSITION_MS,
  PiIntroComponent,
  type IntroScheduler,
} from "../intro-component.ts";

const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

interface ScheduledCallback {
  callback: () => void;
  dueAt: number;
  intervalMs?: number;
}

class FakeScheduler implements IntroScheduler {
  currentTime = 0;
  nextId = 1;
  callbacks = new Map<number, ScheduledCallback>();
  cleared: number[] = [];

  now(): number {
    return this.currentTime;
  }

  setInterval(callback: () => void, milliseconds: number): number {
    return this.schedule(callback, milliseconds, milliseconds);
  }

  clearInterval(handle: unknown): void {
    this.clear(handle);
  }

  setTimeout(callback: () => void, milliseconds: number): number {
    return this.schedule(callback, milliseconds);
  }

  clearTimeout(handle: unknown): void {
    this.clear(handle);
  }

  advance(milliseconds: number): void {
    const targetTime = this.currentTime + milliseconds;

    while (true) {
      const dueTime = Math.min(
        ...[...this.callbacks.values()]
          .map((scheduled) => scheduled.dueAt)
          .filter((time) => time <= targetTime),
      );
      if (!Number.isFinite(dueTime)) break;

      this.currentTime = dueTime;
      const dueCallbacks = [...this.callbacks.entries()]
        .filter(([, scheduled]) => scheduled.dueAt === dueTime);
      for (const [id, scheduled] of dueCallbacks) {
        if (scheduled.intervalMs === undefined) this.callbacks.delete(id);
        else scheduled.dueAt += scheduled.intervalMs;
        scheduled.callback();
      }
    }

    this.currentTime = targetTime;
  }

  private schedule(callback: () => void, milliseconds: number, intervalMs?: number): number {
    const id = this.nextId;
    this.nextId += 1;
    this.callbacks.set(id, {
      callback,
      dueAt: this.currentTime + milliseconds,
      ...(intervalMs === undefined ? {} : { intervalMs }),
    });
    return id;
  }

  private clear(handle: unknown): void {
    const id = handle as number;
    if (this.callbacks.delete(id)) this.cleared.push(id);
  }
}

class DelayedTimeoutScheduler implements IntroScheduler {
  currentTime = 0;
  nextId = 1;
  intervals = new Map<number, () => void>();
  timeouts = new Map<number, { callback: () => void; dueAt: number }>();

  now(): number {
    return this.currentTime;
  }

  setInterval(callback: () => void): number {
    const id = this.nextId++;
    this.intervals.set(id, callback);
    return id;
  }

  clearInterval(handle: unknown): void {
    this.intervals.delete(handle as number);
  }

  setTimeout(callback: () => void, milliseconds: number): number {
    const id = this.nextId++;
    this.timeouts.set(id, { callback, dueAt: this.currentTime + milliseconds });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.timeouts.delete(handle as number);
  }

  elapseWithoutCallbacks(milliseconds: number): void {
    this.currentTime += milliseconds;
  }

  runDueTimeouts(): void {
    const due = [...this.timeouts.entries()]
      .filter(([, timeout]) => timeout.dueAt <= this.currentTime)
      .sort((left, right) => left[1].dueAt - right[1].dueAt);
    for (const [id, timeout] of due) {
      this.timeouts.delete(id);
      timeout.callback();
    }
  }
}

const theme = {
  fg: (color: string, text: string) => `\x1b[${color === "accent" ? 35 : 37}m${text}\x1b[0m`,
  bold: (text: string) => `\x1b[1m${text}\x1b[22m`,
};

function createComponent(rows = 24) {
  const scheduler = new FakeScheduler();
  const state = { renders: 0, done: 0 };
  const host = {
    rows,
    requestRender: () => { state.renders += 1; },
  };
  const component = new PiIntroComponent({
    host,
    theme,
    scheduler,
    onDone: () => { state.done += 1; },
  });

  return { component, scheduler, state, host };
}

function visibleWidth(line: string): number {
  return line.replace(ANSI_PATTERN, "").length;
}

test("renders a viewport-sized centered reveal without exceeding terminal width", () => {
  const { component, scheduler, state } = createComponent(24);
  component.start();
  scheduler.advance(1050);

  const lines = component.render(80);
  assert.equal(lines.length, 24);
  assert.ok(lines.some((line) => line.includes("█")));
  assert.ok(lines.every((line) => visibleWidth(line) === 80));
  assert.ok(state.renders >= 2);

  component.dispose();
});

test("falls back to a compact mark in narrow or short terminals", () => {
  const { component, scheduler } = createComponent(5);
  component.start();
  scheduler.advance(600);

  const lines = component.render(12);
  assert.equal(lines.length, 5);
  assert.ok(lines.some((line) => line.includes("PI")));
  assert.ok(lines.every((line) => visibleWidth(line) === 12));

  component.dispose();
});

test("any key skips once and clears every pending timer", () => {
  const { component, scheduler, state } = createComponent();
  component.start();

  component.handleInput("x");
  component.handleInput("escape");

  assert.equal(state.done, 1);
  assert.deepEqual(scheduler.cleared, [1, 2]);
  assert.equal(scheduler.callbacks.size, 0);
});

test("holds the completed transition for 750ms before restoring Pi", () => {
  const { component, scheduler, state } = createComponent();
  component.start();

  scheduler.advance(INTRO_TRANSITION_MS - 1);
  assert.equal(state.done, 0);

  const rendersBeforeHold = state.renders;
  scheduler.advance(1);
  assert.equal(state.done, 0);
  assert.ok(state.renders > rendersBeforeHold);
  const rendersAtHold = state.renders;
  assert.ok(component.render(80).some((line) => line.includes("█")));

  scheduler.advance(INTRO_HOLD_MS - 1);
  assert.equal(state.done, 0);
  assert.equal(state.renders, rendersAtHold);

  scheduler.advance(1);
  assert.equal(state.done, 1);
  assert.equal(INTRO_DURATION_MS, INTRO_TRANSITION_MS + INTRO_HOLD_MS);
  assert.deepEqual(scheduler.cleared, [1]);

  component.dispose();
  component.dispose();
  assert.deepEqual(scheduler.cleared, [1]);
});

test("a delayed transition callback still schedules a full 750ms visual hold", () => {
  const scheduler = new DelayedTimeoutScheduler();
  const state = { renders: 0, done: 0 };
  const component = new PiIntroComponent({
    host: { rows: 24, requestRender: () => { state.renders += 1; } },
    theme,
    scheduler,
    onDone: () => { state.done += 1; },
  });
  component.start();

  scheduler.elapseWithoutCallbacks(INTRO_TRANSITION_MS + 100);
  scheduler.runDueTimeouts();
  const holdStartedAt = scheduler.now();
  assert.equal(state.done, 0);

  scheduler.elapseWithoutCallbacks(INTRO_HOLD_MS - 1);
  scheduler.runDueTimeouts();
  assert.equal(state.done, 0);

  scheduler.elapseWithoutCallbacks(1);
  scheduler.runDueTimeouts();
  assert.equal(scheduler.now() - holdStartedAt, INTRO_HOLD_MS);
  assert.equal(state.done, 1);
});

test("any key still skips immediately during the completed-frame hold", () => {
  const { component, scheduler, state } = createComponent();
  component.start();
  scheduler.advance(INTRO_TRANSITION_MS);

  component.handleInput("space");

  assert.equal(state.done, 1);
  assert.deepEqual(scheduler.cleared, [1, 3]);
});
