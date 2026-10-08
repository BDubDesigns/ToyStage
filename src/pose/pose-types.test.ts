import { describe, expect, it } from "vitest";
import { getCameraRect } from "../compositor-layout";
import { JOINT, isPoseFresh, jointReliability, mapImagePoint } from "./pose-types";
import type { PoseFrame } from "./pose-types";

describe("pose coordinates and reliability", () => {
  it.each([[1280, 720, 720, 1280], [720, 1280, 1280, 720], [1000, 1000, 640, 480]])("contains %i×%i stage / %i×%i camera without stretching", (w, h, vw, vh) => {
    const rect = getCameraRect(w, h, vw, vh);
    const layout = { rect, mirrored: false };
    expect(mapImagePoint({ x: 0, y: 0 }, layout)).toEqual({ x: rect.x, y: rect.y });
    expect(mapImagePoint({ x: 0.5, y: 0.5 }, layout)).toEqual({ x: 0.5, y: 0.5 });
    expect(rect.width * w / (rect.height * h)).toBeCloseTo(vw / vh);
  });
  it("mirrors x once without swapping anatomical indices or clamping geometry", () => {
    const rect = { x: 0.1, y: 0.2, width: 0.8, height: 0.6 };
    expect(mapImagePoint({ x: 0.25, y: 0.75 }, { rect, mirrored: true }).x).toBeCloseTo(0.7);
    const outside = mapImagePoint({ x: -0.2, y: 1.2 }, { rect, mirrored: false });
    expect(outside.x).toBeLessThan(0);
    expect(outside.y).toBeCloseTo(0.92);
    expect(JOINT.leftWrist).toBe(15);
    expect(Object.keys(JOINT)).toHaveLength(33);
  });
  it("explains missing, nonfinite and low confidence; presence is optional", () => {
    expect(jointReliability({ x: 0, y: 0 })).toBe("missing-confidence");
    expect(jointReliability({ x: NaN, y: 0, visibility: 1 })).toBe("invalid");
    expect(jointReliability({ x: 0, y: 0, visibility: 0.49 })).toBe("low-visibility");
    expect(jointReliability({ x: 0, y: 0, visibility: 1, presence: 0.49 })).toBe("low-presence");
    expect(jointReliability({ x: 0, y: 0, visibility: 0.5 })).toBe("reliable");
  });
  it("measures freshness from capture, not recently received old inference", () => {
    const frame = { capturedAt: 100, receivedAt: 399 } as PoseFrame;
    expect(isPoseFresh(frame, 400)).toBe(true);
    expect(isPoseFresh(frame, 401)).toBe(false);
    expect(isPoseFresh(frame, 99)).toBe(false);
    expect(isPoseFresh(null, 100)).toBe(false);
  });
});
