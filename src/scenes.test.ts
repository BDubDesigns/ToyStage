import { afterEach, describe, expect, it, vi } from "vitest";
import { getSceneUvScale, SceneImages, SCENES } from "./scenes";

afterEach(() => vi.unstubAllGlobals());

describe("scene fitting", () => {
  it.each([[1280, 720], [390, 520], [844, 390], [720, 1280]])("fills %ix%i without stretching", (width, height) => {
    const [x, y] = getSceneUvScale(width, height, 1280, 720);
    expect(Math.max(x, y)).toBeCloseTo(1);
    expect(Math.min(x, y)).toBeGreaterThan(0);
    expect((x * 1280) / (y * 720)).toBeCloseTo(width / height);
  });
});

describe("built-in image lifecycle", () => {
  function fakeImages() {
    const instances: { onload: (() => void) | null; onerror: (() => void) | null; src: string }[] = [];
    vi.stubGlobal("Image", class {
      onload = null;
      onerror = null;
      src = "";
      constructor() { instances.push(this); }
    });
    return instances;
  }
  it("shares still loads and reuses the decoded image when revisiting", async () => {
    const instances = fakeImages();
    const images = new SceneImages();
    const first = images.load(SCENES[0]);
    expect(images.load(SCENES[0])).toBe(first);
    expect(instances).toHaveLength(1);
    instances[0].onload!();
    expect(await first).toBe(instances[0]);
    expect(await images.load(SCENES[0])).toBe(instances[0]);
    expect(instances[0].onload).toBeNull();
    expect(instances[0].onerror).toBeNull();
  });
  it("allows retry after a failed asset and needs no image for animation", async () => {
    const instances = fakeImages();
    const images = new SceneImages();
    const failed = images.load(SCENES[1]);
    const rejected = expect(failed).rejects.toThrow("Could not load Lunar Outpost");
    instances[0].onerror!();
    await rejected;
    const retry = images.load(SCENES[1]);
    expect(instances).toHaveLength(2);
    instances[1].onload!();
    await retry;
    expect(await images.load(SCENES[4])).toBeNull();
    expect(instances).toHaveLength(2);
  });
});
