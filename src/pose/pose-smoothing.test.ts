import { describe, expect, it } from "vitest";
import { PoseSmoother } from "./pose-smoothing";
import type { ImageLandmark } from "./pose-types";

const layout = { rect: { x: 0, y: 0, width: 1, height: 1 }, mirrored: false };
const body = (x = 0.5, visibility = 1): ImageLandmark[] => Array.from({ length: 33 }, () => ({ x, y: 0.5, z: 0, visibility }));

describe("pose smoothing and velocity", () => {
  it("seeds, smooths jitter and derives recent velocity in stage widths/second", () => {
    const smoother = new PoseSmoother();
    expect(smoother.update(body(), 0, layout).landmarks[15].vx).toBe(0);
    const pose = smoother.update(body(0.6), 100, layout);
    expect(pose.landmarks[15].x).toBeGreaterThan(0.5);
    expect(pose.landmarks[15].x).toBeLessThan(0.6);
    expect(pose.landmarks[15].vx).toBeCloseTo((pose.landmarks[15].x - 0.5) / 0.1);
    expect(pose.state).toBe("tracked");
    expect(Object.isFrozen(pose.landmarks[15].raw)).toBe(true);
    expect(Object.isFrozen(pose.landmarks)).toBe(true);
  });
  it("removes occluded joints immediately and reacquires with zero velocity", () => {
    const smoother = new PoseSmoother();
    smoother.update(body(), 0, layout);
    const hidden = body(0.6); hidden[15] = { ...hidden[15], visibility: 0.1 };
    const partial = smoother.update(hidden, 100, layout);
    expect(partial.state).toBe("partial");
    expect(partial.landmarks[15].reliable).toBe(false);
    expect(partial.landmarks[15].vx).toBe(0);
    expect(smoother.update(body(0.8), 200, layout).landmarks[15].vx).toBe(0);
  });
  it("seeds on gaps, teleports, explicit reset and unusable poses", () => {
    const smoother = new PoseSmoother();
    smoother.update(body(), 0, layout);
    expect(smoother.update(body(0.6), 301, layout).landmarks[0].vx).toBe(0);
    expect(smoother.update(body(0.95), 400, layout).landmarks[0].vx).toBe(0);
    smoother.reset();
    expect(smoother.update(body(0.9), 500, layout).landmarks[0].vx).toBe(0);
    expect(smoother.update(body(0.9, 0.1), 600, layout).state).toBe("unusable");
    expect(smoother.update(body(0.8), 700, layout).landmarks[0].vx).toBe(0);
  });
  it("rejects tiny dt, derives bounded 5Hz motion, and resets on true gaps", () => {
    const smoother = new PoseSmoother();
    smoother.update(body(), 100, layout);
    expect(smoother.update(body(0.6), 101, layout).landmarks[0].vx).toBe(0);
    const lowRate = smoother.update(body(0.7), 301, layout).landmarks[0];
    expect(lowRate.vx).toBeGreaterThan(0);
    expect(lowRate.vx).toBeLessThan(1);
    expect(smoother.update(body(0.8), 602, layout).landmarks[0].vx).toBe(0);
  });
  it("marks truncated results unusable with a stable 33-index array", () => {
    const pose = new PoseSmoother().update([], 0, layout);
    expect(pose.state).toBe("unusable");
    expect(pose.landmarks).toHaveLength(33);
    expect(pose.landmarks.every((point) => !point.reliable)).toBe(true);
  });
});
