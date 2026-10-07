import { describe, expect, it } from "vitest";
import { colorFromHex, colorToHex, defaultChromaKeySettings, getSamplePoint } from "./chroma-key";
import { getCameraRect } from "./compositor-layout";

describe("calibration coordinates", () => {
  it.each([
    [1280, 720, 1280, 720], [390, 292, 1280, 720],
    [844, 390, 720, 1280], [390, 292, 720, 1280],
  ])("maps stage %ix%i to video %ix%i across aspect/orientation changes", (sw, sh, vw, vh) => {
    const rect = getCameraRect(sw, sh, vw, vh);
    for (const mirrored of [false, true]) {
      for (const [u, v] of [[0.25, 0.25], [0.75, 0.75]]) {
        const point = getSamplePoint(rect.x + u * rect.width, 1 - rect.y - (1 - v) * rect.height, sw, sh, vw, vh, mirrored)!;
        expect(Math.abs(point.x - Math.floor((mirrored ? 1 - u : u) * vw))).toBeLessThanOrEqual(1);
        expect(Math.abs(point.y - Math.floor(v * vh))).toBeLessThanOrEqual(1);
      }
    }
    expect(getSamplePoint(0.01, 0.01, sw, sh, vw, vh, false)).toBeNull();
    expect(getSamplePoint(0.5, 0.5, sw, sh, vw, vh, false)).toEqual({ x: vw / 2, y: vh / 2 });
  });

  it("rejects missing dimensions and clamps the source frame's inclusive edges", () => {
    expect(getSamplePoint(0.5, 0.5, 1, 1, 0, 0, false)).toBeNull();
    const rect = getCameraRect(100, 100, 100, 100);
    expect(getSamplePoint(rect.x + rect.width, 1 - rect.y, 100, 100, 100, 100, false)).toEqual({ x: 99, y: 99 });
  });
});

describe("key settings", () => {
  it("round trips selectable colors", () => {
    for (const hex of ["#000000", "#ffffff", "#1fbf38", "#abcdef"]) expect(colorToHex(colorFromHex(hex))).toBe(hex);
  });
  it("reset returns independent, useful defaults", () => {
    const settings = defaultChromaKeySettings();
    settings.enabled = false;
    settings.color = [1, 0, 0];
    expect(defaultChromaKeySettings()).toMatchObject({ enabled: true, showMask: false, color: [0.08, 0.8, 0.12] });
  });
});
