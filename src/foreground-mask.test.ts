import { describe, expect, it } from "vitest";
import { ForegroundMask, getMaskSize } from "./foreground-mask";

// Input written as human-readable top-to-bottom rows; GPU storage is reversed.
function frame(rows: number[][]): Uint8Array {
  return new Uint8Array(rows.slice().reverse().flatMap(row => row.flatMap(value => [value, value, value, 255])));
}
const whole = { x: 0, y: 0, width: 1, height: 1 };

describe("foreground sensing queries", () => {
  it("bounds readback area in wide, phone, and portrait stages", () => {
    expect(getMaskSize(1280, 720)).toEqual({ width: 160, height: 90 });
    expect(getMaskSize(720, 1280)).toEqual({ width: 90, height: 160 });
    expect(getMaskSize(720, 540)).toEqual({ width: 120, height: 90 });
    expect(getMaskSize(1280, 720, 80)).toEqual({ width: 80, height: 45 });
  });

  it("flips GPU rows into top-left stage coordinates and thresholds feathered edges", () => {
    const mask = new ForegroundMask();
    mask.update(frame([[255, 127], [0, 128]]), 2, 2, 100);
    expect(mask.occupied(0, 0)).toBe(true);
    expect(mask.occupied(1, 0)).toBe(false);
    expect(mask.occupied(0, 1)).toBe(false);
    expect(mask.occupied(1, 1)).toBe(true);
    expect(mask.coverage(whole)).toBe(0.5);
    expect(mask.occupied(0.51, 0.25, 0.1)).toBe(true);
  });

  it("clips query regions and rejects invalid or outside coordinates", () => {
    const mask = new ForegroundMask();
    mask.update(frame([[255, 0], [0, 0]]), 2, 2, 100);
    expect(mask.coverage({ x: -0.5, y: -0.5, width: 1, height: 1 })).toBe(1);
    expect(mask.coverage({ x: 2, y: 0, width: 1, height: 1 })).toBe(0);
    expect(mask.coverage({ x: 0, y: 0, width: -1, height: 1 })).toBe(0);
    expect(mask.coverage({ ...whole, x: NaN })).toBe(0);
    for (const [x, y, r] of [[NaN, 0, 0], [0, Infinity, 0], [-0.01, 0, 0], [1.01, 0, 0], [0, 0, -1]]) expect(mask.occupied(x, y, r)).toBe(false);
    const copy = mask.pixels();
    copy.fill(0);
    expect(mask.occupied(0, 0)).toBe(true);
  });

  it("reports change and centroid velocity in stage units per second", () => {
    const mask = new ForegroundMask();
    mask.update(frame([[255, 255, 0, 0], [0, 0, 0, 0]]), 4, 2, 100);
    expect(mask.motion()).toEqual({ changed: 0, velocity: null, intervalMs: 0 });
    mask.update(frame([[0, 255, 255, 0], [0, 0, 0, 0]]), 4, 2, 200);
    expect(mask.motion()).toEqual({ changed: 0.25, velocity: { x: 2.5, y: 0 }, intervalMs: 100 });
    expect(mask.motion({ x: 0, y: 0.5, width: 1, height: 0.5 }).changed).toBe(0);
    mask.update(frame([[0, 255, 255, 0], [0, 0, 0, 0]]), 4, 2, 300);
    expect(mask.motion().velocity).toEqual({ x: 0, y: 0 });
    expect(mask.motion().changed).toBe(0);
  });

  it("does not invent a velocity for entry/exit or compare across pauses and resets", () => {
    const mask = new ForegroundMask();
    const empty = frame([[0, 0], [0, 0]]), solid = frame([[255, 255], [255, 255]]);
    mask.update(empty, 2, 2, 100);
    mask.update(solid, 2, 2, 200);
    expect(mask.motion()).toEqual({ changed: 1, velocity: null, intervalMs: 100 });
    mask.update(empty, 2, 2, 1000);
    expect(mask.motion().intervalMs).toBe(0);
    mask.update(solid, 2, 2, 1100);
    mask.reset();
    expect(mask.timestamp).toBeNull();
    expect(mask.occupied(0.5, 0.5)).toBe(false);
    expect(mask.coverage(whole)).toBe(0);
    mask.update(solid, 2, 2, 1200);
    expect(mask.motion().intervalMs).toBe(0);
    mask.update(frame([[255, 255, 0]]), 3, 1, 1300);
    expect(mask.motion().intervalMs).toBe(0);
  });
});
