import { describe, expect, it } from "vitest";
import { Ball } from "./ball";
import { ForegroundMask } from "./foreground-mask";
import { getCameraRect } from "./compositor-layout";

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
function strike(interval: number): { ball: Ball; mask: ForegroundMask } {
  const ball = new Ball(), mask = new ForegroundMask();
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
