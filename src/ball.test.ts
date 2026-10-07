import { describe, expect, it } from "vitest";
import { Ball } from "./ball";
import { ForegroundMask } from "./foreground-mask";
import { getCameraRect } from "./compositor-layout";
import { BALL_PROFILES } from "./ball-profiles";
import type { BallType } from "./ball-profiles";
import { getOffscreenIndicator } from "./ball-view";

function update(mask: ForegroundMask, time: number, rect?: { x: number; y: number; width: number; height: number }): void {
  const w = 160, h = 90, rgba = new Uint8Array(w * h * 4);
  if (rect) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const px = (x + 0.5) / w, py = (y + 0.5) / h;
      if (px >= rect.x && px <= rect.x + rect.width && py >= rect.y && py <= rect.y + rect.height) rgba[((h - 1 - y) * w + x) * 4] = 255;
    }
  }
  mask.update(rgba, w, h, time);
}
const toy = (x: number) => ({ x, y: 0.42, width: 0.04, height: 0.06 });
function strike(interval: number, type: BallType = "eight-ball"): { ball: Ball; mask: ForegroundMask } {
  const ball = new Ball(type), mask = new ForegroundMask();
  update(mask, 100, toy(0.39)); ball.tick(100, mask);
  update(mask, 100 + interval, toy(0.45)); ball.tick(100 + interval, mask);
  return { ball, mask };
}

describe("physical foreground ball demo", () => {
  it("responds rightward to a toy arriving from the left, with faster motion producing a stronger hit", () => {
    const slow = strike(200).ball, fast = strike(67).ball;
    expect(slow.debug.hits).toBe(1);
    expect(fast.debug.hits).toBe(1);
    expect(slow.vx).toBeGreaterThan(0);
    expect(fast.vx).toBeGreaterThan(slow.vx);
    expect(Math.abs(fast.vy)).toBeLessThan(0.02);
  });

  it("never consumes the same sensing sample twice or pumps a sustained static overlap", () => {
    const { ball, mask } = strike(67);
    for (let time = 170; time < 250; time += 10) ball.tick(time, mask);
    expect(ball.debug.hits).toBe(1);
    const solid = { x: 0, y: 0, width: 1, height: 1 };
    for (let i = 0; i < 120; i++) { const time = 250 + i * 67; update(mask, time, solid); ball.tick(time, mask); }
    expect(ball.debug.hits).toBe(1);
    expect(Math.hypot(ball.vx, ball.vy)).toBe(0);
  });

  it("rearms after two clear samples and allows a second deliberate strike", () => {
    const { ball, mask } = strike(67);
    update(mask, 234); ball.tick(234, mask);
    update(mask, 301); ball.tick(301, mask);
    ball.vx = ball.vy = 0;
    ball.x = 0.5; ball.y = 0.45;
    update(mask, 368, toy(0.39)); ball.tick(368, mask);
    update(mask, 435, toy(0.45)); ball.tick(435, mask);
    expect(ball.debug.hits).toBe(2);
  });

  it("does not hit a stationary toy on start, reset, recalibration, or resume", () => {
    const ball = new Ball(), mask = new ForegroundMask();
    for (const time of [100, 167, 234]) { update(mask, time, toy(0.45)); ball.tick(time, mask); }
    expect(ball.debug.hits).toBe(0);
    ball.reset();
    update(mask, 301, toy(0.45)); ball.tick(301, mask);
    update(mask, 368, toy(0.45)); ball.tick(368, mask);
    mask.reset(); ball.tick(400, mask);
    update(mask, 500, toy(0.45)); ball.tick(500, mask);
    update(mask, 567, toy(0.45)); ball.tick(567, mask);
    ball.pause();
    update(mask, 2000, toy(0.45)); ball.tick(2000, mask);
    update(mask, 2067, toy(0.45)); ball.tick(2067, mask);
    expect(ball.debug.hits).toBe(0);
    expect([ball.x, ball.y, ball.vx, ball.vy]).toEqual([0.5, 0.45, 0, 0]);
  });

  it("freezes stale input and resumes without a time-jump or phantom hit", () => {
    const { ball, mask } = strike(67);
    const position = { x: ball.x, y: ball.y };
    ball.tick(5000, mask);
    expect(ball.debug.fresh).toBe(false);
    expect({ x: ball.x, y: ball.y }).toEqual(position);
    update(mask, 5067, toy(0.45)); ball.tick(5067, mask);
    expect({ x: ball.x, y: ball.y }).toEqual(position);
    expect(ball.debug.hits).toBe(1);
  });

  it("can bounce off an unchanged foreground object using its contact normal", () => {
    const ball = new Ball(), mask = new ForegroundMask();
    ball.x = 0.38; ball.y = 0.45;
    update(mask, 100, toy(0.48)); ball.tick(100, mask);
    ball.vx = 1;
    ball.x = 0.45;
    update(mask, 167, toy(0.48)); ball.tick(167, mask);
    expect(ball.debug.hits).toBe(1);
    expect(ball.vx).toBeLessThan(0);
  });

  it("pushes away from new occupancy even without a comparable toy centroid", () => {
    const ball = new Ball(), mask = new ForegroundMask();
    update(mask, 100); ball.tick(100, mask);
    update(mask, 167, toy(0.45)); ball.tick(167, mask);
    expect(ball.debug.motion).toBeNull();
    expect(ball.debug.hits).toBe(1);
    expect(ball.vx).toBeGreaterThan(0);
  });

  it.each([[1280, 720, 640, 360], [390, 292, 360, 640], [720, 1280, 640, 360]])("stays round, reachable, and bounded for stage %ix%i and camera %ix%i", (w, h, vw, vh) => {
    const ball = new Ball(), mask = new ForegroundMask(), rect = getCameraRect(w, h, vw, vh);
    ball.layout(w, h, rect);
    expect(ball.radiusX * w).toBeCloseTo(ball.radiusY * h);
    ball.reset(5, -5);
    expect(ball.x + ball.radiusX).toBeCloseTo(rect.x + rect.width);
    expect(ball.y - ball.radiusY).toBeCloseTo(rect.y);
    ball.vx = 1.8; ball.vy = -1.8;
    for (let i = 0; i < 300; i++) {
      const time = 100 + i * 33;
      update(mask, time); ball.tick(time, mask);
      expect(ball.x).toBeGreaterThanOrEqual(rect.x + ball.radiusX - 1e-9);
      expect(ball.x).toBeLessThanOrEqual(rect.x + rect.width - ball.radiusX + 1e-9);
      expect(ball.y).toBeGreaterThanOrEqual(rect.y + ball.radiusY - 1e-9);
      expect(ball.y).toBeLessThanOrEqual(rect.y + rect.height - ball.radiusY + 1e-9);
    }
    expect(ball.vx).toBe(0);
    expect(ball.vy).toBe(0);
  });

  it("keeps an empty mask free of false hits and clamps extreme inferred motion", () => {
    const ball = new Ball(), mask = new ForegroundMask();
    for (let i = 0; i < 100; i++) { const time = 100 + i * 67; update(mask, time); ball.tick(time, mask); }
    expect(ball.debug.hits).toBe(0);
    const extreme = strike(1).ball;
    expect(extreme.debug.hits).toBe(1);
    expect(Math.hypot(extreme.vx, extreme.vy)).toBeLessThanOrEqual(2);
  });
});

// Physics-only clock with fresh empty input; contact tests above/below use the
// real low-resolution mask. Run at the compositor's 30 fps, including substeps.
function simulate(ball: Ball) {
  const mask = new ForegroundMask();
  let now = 100;
  mask.timestamp = now;
  ball.tick(now, mask);
  return (seconds: number, frame?: () => void): void => {
    for (let i = 0; i < Math.round(seconds * 30); i++) {
      mask.timestamp = now += 1000 / 30;
      ball.tick(now, mask);
      frame?.();
    }
  };
}

describe("material ball profiles", () => {
  it("keeps the 8 Ball's original no-gravity damping and wall response", () => {
    const ball = new Ball(), run = simulate(ball);
    ball.vx = 0.5;
    const y = ball.y;
    run(0.5);
    expect(ball.vx).toBeCloseTo(0.5 * Math.exp(-1.05 * 0.5), 8);
    expect(ball.y).toBe(y);
    expect(ball.grounded).toBe(false);
    ball.reset(0.5, 0); ball.vy = -1;
    run(0.1);
    expect(ball.vy).toBeGreaterThan(0);
    expect(ball.aboveStage).toBe(false);
  });

  it("basketball bounces progressively lower, then rests without floor jitter", () => {
    const ball = new Ball("basketball"), run = simulate(ball), rebounds: number[] = [];
    let previous = ball.vy;
    run(15, () => {
      if (previous > 0 && ball.vy < 0) rebounds.push(-ball.vy);
      previous = ball.vy;
    });
    expect(rebounds.length).toBeGreaterThan(4);
    for (let i = 1; i < rebounds.length; i++) expect(rebounds[i]).toBeLessThan(rebounds[i - 1]);
    expect(ball.grounded).toBe(true);
    const y = ball.y;
    run(5);
    expect(ball.y).toBe(y);
    expect(ball.vy).toBe(0);
  });

  it("bowling ball lands almost dead, while Super Ball keeps rebounding far higher than basketball", () => {
    const heights = new Map<BallType, number>();
    for (const type of ["basketball", "bowling-ball", "super-ball", "dodgeball"] as const) {
      const ball = new Ball(type), run = simulate(ball);
      const floor = 1 - ball.radiusY;
      let landed = false, height = 0, previous = ball.vy;
      run(3, () => {
        if (previous > 0 && ball.vy <= 0) landed = true;
        if (landed) height = Math.max(height, floor - ball.y);
        previous = ball.vy;
      });
      heights.set(type, height);
      if (type === "bowling-ball") expect(ball.grounded).toBe(true);
      if (type === "super-ball") {
        run(5);
        expect(ball.grounded).toBe(false);
        expect(Math.abs(ball.vy)).toBeGreaterThan(0.1);
      }
    }
    expect(heights.get("bowling-ball")!).toBeLessThan(0.005);
    expect(heights.get("dodgeball")!).toBeLessThan(heights.get("basketball")!);
    expect(heights.get("super-ball")!).toBeGreaterThan(heights.get("basketball")! * 1.3);
  });

  it("damps grounded rolling, with much stronger resistance for the bowling ball", () => {
    const speeds = new Map<BallType, number>();
    for (const type of ["bowling-ball", "basketball", "super-ball"] as const) {
      const ball = new Ball(type);
      ball.reset(0.3, 1); ball.vx = 0.5;
      const run = simulate(ball);
      run(0.5);
      expect(ball.grounded).toBe(true);
      speeds.set(type, ball.vx);
    }
    expect(speeds.get("bowling-ball")).toBe(0);
    expect(speeds.get("super-ball")!).toBeGreaterThan(speeds.get("basketball")!);
  });

  it.each(BALL_PROFILES.filter(p => p.bounds === "gravity").map(p => p.id))("%s moves after even the gentlest supported nudge", type => {
    const ball = new Ball(type);
    ball.reset(0.5, 1);
    // Minimum #7 hit strength, scaled by material. It must survive the first
    // integration frame instead of being mistaken for settled floor motion.
    ball.vx = 0.22 * ball.profile.hitScale;
    const run = simulate(ball);
    run(1 / 30);
    expect(ball.x).toBeGreaterThan(0.5);
    expect(ball.vx).toBeGreaterThan(0);
  });

  it("balloon descends gently from rest, loses upward speed and returns from above without a ceiling", () => {
    const ball = new Ball("balloon"), run = simulate(ball);
    run(1);
    expect(ball.y).toBeGreaterThan(0.45);
    expect(ball.y).toBeLessThan(0.56);
    expect(ball.vy).toBeGreaterThan(0);
    expect(ball.vy).toBeLessThan(0.25);
    ball.reset(0.5, 0.2); ball.vy = -2.5;
    let left = false, returned = false, previous = ball.vy;
    run(15, () => {
      if (ball.vy < 0 && previous < 0) expect(ball.vy).toBeGreaterThanOrEqual(previous);
      if (ball.aboveStage) left = true;
      if (left && !ball.aboveStage) returned = true;
      previous = ball.vy;
    });
    expect(left).toBe(true);
    expect(returned).toBe(true);
    expect(ball.vy).toBeLessThan(0.25);
  });

  it.each(BALL_PROFILES.filter(p => p.bounds === "gravity").map(p => p.id))("%s crosses the camera top and stage top, continues airborne and returns", type => {
    const ball = new Ball(type);
    ball.layout(1280, 720, getCameraRect(1280, 720, 640, 360));
    ball.reset(0.5, 0.1); ball.vy = -ball.profile.maxSpeed;
    const run = simulate(ball);
    let left = false, returned = false;
    run(20, () => {
      if (ball.aboveStage) left = true;
      if (left && !ball.aboveStage) returned = true;
      expect(ball.y).toBeLessThanOrEqual(ball.bounds.y + ball.bounds.height - ball.radiusY + 1e-9);
    });
    expect(left).toBe(true);
    expect(returned).toBe(true);
  });

  it("side walls remain active above the stage and reflect materials differently", () => {
    const speeds: number[] = [];
    for (const type of ["bowling-ball", "basketball", "super-ball"] as const) {
      const ball = new Ball(type);
      ball.x = 1 - ball.radiusX - 0.001; ball.y = -0.3; ball.vx = 1;
      const run = simulate(ball);
      run(1 / 30);
      expect(ball.vx).toBeLessThan(0);
      expect(ball.x).toBeLessThanOrEqual(1 - ball.radiusX);
      speeds.push(-ball.vx);
    }
    expect(speeds[0]).toBeLessThan(speeds[1] * 0.3);
    expect(speeds[2]).toBeGreaterThan(speeds[1]);
  });

  it.each(BALL_PROFILES.map(p => p.id))("%s keeps faster hits stronger and does not pump sustained overlap", type => {
    const slow = strike(120, type).ball;
    const { ball, mask } = strike(40, type);
    expect(ball.debug.hits).toBe(1);
    expect(slow.debug.hits).toBe(1);
    expect(Math.hypot(ball.debug.impulse.x, ball.debug.impulse.y)).toBeGreaterThan(Math.hypot(slow.debug.impulse.x, slow.debug.impulse.y));
    expect(Math.hypot(ball.vx, ball.vy)).toBeLessThanOrEqual(ball.profile.maxSpeed + 1e-9);
    for (let i = 0; i < 120; i++) {
      const time = 200 + i * 67;
      update(mask, time, { x: 0, y: 0, width: 1, height: 1 }); ball.tick(time, mask);
    }
    expect(ball.debug.hits).toBe(1);
  });

  it.each(BALL_PROFILES.filter(p => p.bounds === "gravity").map(p => p.id))("a settled %s wakes on a hit and seeds overlap after reset", type => {
    const ball = new Ball(type), mask = new ForegroundMask();
    ball.reset(0.5, 1);
    const y = ball.y - 0.03;
    update(mask, 100, { x: 0.39, y, width: 0.04, height: 0.06 }); ball.tick(100, mask);
    update(mask, 167, { x: 0.45, y, width: 0.04, height: 0.06 }); ball.tick(167, mask);
    expect(ball.debug.hits).toBe(1);
    expect(ball.vx).toBeGreaterThan(0);
    ball.reset(0.5, 1);
    update(mask, 234, { x: 0.45, y, width: 0.04, height: 0.06 }); ball.tick(234, mask);
    update(mask, 301, { x: 0.45, y, width: 0.04, height: 0.06 }); ball.tick(301, mask);
    expect(ball.debug.hits).toBe(0);
    expect(ball.vx).toBe(0);
    expect(ball.grounded).toBe(true);
    // Fresh occupancy underneath also wakes floor support upward when there
    // is no comparable toy centroid (the existing #7 fallback hit path).
    ball.reset(0.5, 1);
    update(mask, 400); ball.tick(400, mask);
    update(mask, 467, { x: 0.5 - ball.radiusX * 0.6, y: ball.y + ball.radiusY * 0.35, width: ball.radiusX * 1.2, height: ball.radiusY * 0.6 });
    ball.tick(467, mask);
    expect(ball.vy).toBeLessThan(0);
    expect(ball.grounded).toBe(false);
    const floor = ball.y;
    update(mask, 500); ball.tick(500, mask);
    expect(ball.y).toBeLessThan(floor);
  });

  it("off-screen pause/resume preserves physics without time jumps; changing type clears incompatible state", () => {
    const ball = new Ball("balloon"), mask = new ForegroundMask();
    ball.x = 0.6; ball.y = -0.4; ball.vy = -1;
    update(mask, 100); ball.tick(100, mask);
    ball.tick(1000, mask);
    expect([ball.x, ball.y, ball.vy]).toEqual([0.6, -0.4, -1]);
    update(mask, 1100); ball.tick(1100, mask);
    expect([ball.x, ball.y, ball.vy]).toEqual([0.6, -0.4, -1]);
    update(mask, 1133); ball.tick(1133, mask);
    expect(ball.y).toBeLessThan(-0.4);
    ball.setType("bowling-ball");
    expect([ball.x, ball.y, ball.vx, ball.vy, ball.debug.hits]).toEqual([0.5, 0.45, 0, 0, 0]);
    expect(ball.aboveStage).toBe(false);
    expect(ball.debug.fresh).toBe(false);
  });

  it.each([[1280, 720, 640, 360], [390, 292, 360, 640], [720, 1280, 640, 360]])("keeps preset proportions and clamped placement on stage %ix%i / camera %ix%i", (w, h, vw, vh) => {
    const radii: number[] = [];
    for (const type of ["super-ball", "basketball", "dodgeball"] as const) {
      const ball = new Ball(type), rect = getCameraRect(w, h, vw, vh);
      ball.layout(w, h, rect);
      expect(ball.radiusX * w).toBeCloseTo(ball.radiusY * h);
      radii.push(ball.radius);
      ball.reset(5, -5);
      expect(ball.x + ball.radiusX).toBeCloseTo(rect.x + rect.width);
      expect(ball.y - ball.radiusY).toBeCloseTo(rect.y);
      ball.vy = -1;
      const run = simulate(ball);
      run(1);
      ball.layout(h, w, getCameraRect(h, w, vw, vh));
      expect(ball.vy).toBe(0);
      expect(ball.aboveStage).toBe(false);
    }
    expect(radii[2] / radii[0]).toBeCloseTo(2);
    expect(radii[1]).toBeGreaterThan(radii[0]);
  });

  it("indicator tracks off-screen x, clamps at corners, hides on re-entry and never mutates the ball", () => {
    const ball = new Ball("basketball");
    ball.y = -ball.radiusY - 0.001; ball.x = 0.7; ball.vy = -1;
    const state = [ball.x, ball.y, ball.vx, ball.vy];
    const marker = getOffscreenIndicator(ball, 1280, 720)!;
    expect(marker.x).toBeCloseTo(1280 * 0.7);
    expect(marker.y - marker.size).toBeGreaterThanOrEqual(0);
    expect([ball.x, ball.y, ball.vx, ball.vy]).toEqual(state);
    ball.x = 0;
    expect(getOffscreenIndicator(ball, 1280, 720)!.x - marker.size).toBeGreaterThan(0);
    ball.x = 1;
    expect(getOffscreenIndicator(ball, 1280, 720)!.x + marker.size).toBeLessThan(1280);
    ball.y = -ball.radiusY + 0.001;
    expect(getOffscreenIndicator(ball, 1280, 720)).toBeNull();
    ball.setType("eight-ball"); ball.y = -1;
    expect(getOffscreenIndicator(ball, 1280, 720)).toBeNull();
  });
});
