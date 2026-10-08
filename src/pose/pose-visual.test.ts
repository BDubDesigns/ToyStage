import { describe, expect, it } from "vitest";
import { PoseVisualFilter } from "./pose-visual";
import { JOINT } from "./pose-types";
import type { PoseFrame, PoseLandmark } from "./pose-types";

function frame(capturedAt: number, x: number, velocity = 0, visible = true): PoseFrame {
  const landmarks: PoseLandmark[] = Array.from({ length: 33 }, () => ({
    x: 0.5, y: 0.5, vx: 0, vy: 0,
    reliable: false as boolean, reliability: "low-visibility" as const,
    raw: { x: 0.5, y: 0.5, visibility: 0, presence: 1 },
  }));
  landmarks[JOINT.leftWrist] = {
    x, y: 0.45, vx: velocity, vy: 0,
    reliable: visible, reliability: visible ? "reliable" : "low-visibility",
    raw: { x, y: 0.45, visibility: visible ? 1 : 0, presence: 1 },
  };
  return { frameId: capturedAt, capturedAt, completedAt: capturedAt + 80,
    receivedAt: capturedAt + 80, mediaTime: capturedAt / 1000,
    inferenceMs: 80, captureMs: 1, roundTripMs: 80,
    poses: [{ state: "partial", landmarks }] };
}

describe("render-only pose temporal filter", () => {
  it("reduces jumpy screen updates between 8Hz captures without modifying physics snapshots", () => {
    const visual = new PoseVisualFilter(), original = frame(100, 0.36, 1);
    const first = visual.positions(original, 140)!;
    expect(first[JOINT.leftWrist].x).toBeCloseTo(0.40);
    expect(original.poses[0].landmarks[JOINT.leftWrist].x).toBe(0.36);
    // Repeated same snapshot gently moves the displayed joint toward a
    // bounded extrapolation instead of leaving it at the last inference tick.
    const repeat = visual.positions(original, 173)!;
    expect(repeat[JOINT.leftWrist].x).toBeGreaterThan(first[JOINT.leftWrist].x);
    expect(repeat[JOINT.leftWrist].x).toBeLessThanOrEqual(0.44);
    const next = visual.positions(frame(225, 0.49, 0.8), 305)!;
    expect(next[JOINT.leftWrist].x).toBeGreaterThan(repeat[JOINT.leftWrist].x);
    expect(next[JOINT.leftWrist].x).toBeLessThan(0.57);
  });

  it("never extrapolates farther than 0.08 stage units or past fresh-tracking age", () => {
    const visual = new PoseVisualFilter();
    const fast = frame(100, 0.5, 20);
    expect(visual.positions(fast, 220)![JOINT.leftWrist].x).toBeCloseTo(0.58);
    expect(visual.positions(fast, 410)).toBeNull();
    expect(visual.positions(frame(420, 0.3), 500)![JOINT.leftWrist].x).toBe(0.3);
  });

  it("does not invent occluded joints or interpolate through reacquisition", () => {
    const visual = new PoseVisualFilter();
    visual.positions(frame(100, 0.3, 1), 180);
    const lost = visual.positions(frame(200, 0.6, 1, false), 280)!;
    expect(lost[JOINT.leftWrist].reliable).toBe(false);
    const returnFrame = frame(300, 0.7, 0);
    expect(visual.positions(returnFrame, 380)![JOINT.leftWrist].x).toBe(0.7);
    visual.positions(null, 410);
    expect(visual.positions(frame(420, 0.2), 500)![JOINT.leftWrist].x).toBe(0.2);
  });
});
