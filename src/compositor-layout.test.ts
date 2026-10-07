import { describe, expect, it } from "vitest";
import { getCameraRect, getRenderSize } from "./compositor-layout";

describe("camera fit in stage-normalized coordinates", () => {
  it.each([
    [1280, 720, 1280, 720],
    [360, 640, 1280, 720],
    [1280, 720, 720, 1280],
    [360, 640, 720, 1280],
    [900, 900, 640, 480],
  ])("contains %ix%i stage / %ix%i camera without stretching or cropping", (sw, sh, vw, vh) => {
    const rect = getCameraRect(sw, sh, vw, vh);
    expect(rect.width * sw / (rect.height * sh)).toBeCloseTo(vw / vh);
    expect(rect.x + rect.width / 2).toBeCloseTo(0.5);
    expect(rect.y + rect.height / 2).toBeCloseTo(0.5);
    expect(rect.x).toBeGreaterThanOrEqual(0.039);
    expect(rect.y).toBeGreaterThanOrEqual(0.039);
    expect(Math.max(rect.width, rect.height)).toBeCloseTo(0.92);
  });
});

describe("bounded drawing buffer", () => {
  it.each([
    [1920, 1080, 1],
    [390, 700, 3],
    [700, 390, 3],
    [900, 900, 2],
    [2400, 300, 2],
  ])("bounds %ix%i at DPR %i within a portrait or landscape 720p budget", (width, height, dpr) => {
    const size = getRenderSize(width, height, dpr);
    expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(1280);
    expect(Math.min(size.width, size.height)).toBeLessThanOrEqual(720);
    expect(size.width / size.height).toBeCloseTo(width / height, 2);
  });

  it("uses a safe nonzero buffer while the stage is hidden", () => {
    expect(getRenderSize(0, 0, 1)).toEqual({ width: 1, height: 1 });
  });

  it("does not increase a small stage beyond its device pixel ratio", () => {
    expect(getRenderSize(320, 200, 1)).toEqual({ width: 320, height: 200 });
  });
});
