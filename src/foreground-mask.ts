import type { CameraRect } from "./compositor-layout";

// All public coordinates use the whole visible stage: (0,0) top-left,
// (1,1) bottom-right, including the empty area outside the fitted camera.
export interface MaskMotion {
  changed: number;
  velocity: { x: number; y: number } | null;
  intervalMs: number;
}

export function getMaskSize(stageWidth: number, stageHeight: number, longEdge = 160): { width: number; height: number } {
  const scale = Math.min(longEdge / Math.max(stageWidth, stageHeight), 90 / Math.min(stageWidth, stageHeight), 1);
  return { width: Math.max(1, Math.round(stageWidth * scale)), height: Math.max(1, Math.round(stageHeight * scale)) };
}

export class ForegroundMask {
  width = 0;
  height = 0;
  timestamp: number | null = null;
  private previousTime: number | null = null;
  private current = new Uint8Array(0);
  private previous = new Uint8Array(0);

  reset(): void {
    this.current.fill(0);
    this.previous.fill(0);
    this.timestamp = this.previousTime = null;
  }

  // RGBA readPixels rows run bottom-to-top. Flip only this tiny mask, never
  // the full video. Reuse buffers; a 0.5 alpha cutoff ignores feathered noise.
  update(rgba: Uint8Array, width: number, height: number, timestamp: number): void {
    if (width !== this.width || height !== this.height) {
      this.width = width;
      this.height = height;
      this.current = new Uint8Array(width * height);
      this.previous = new Uint8Array(width * height);
      this.timestamp = null;
    }
    this.previousTime = this.timestamp !== null && timestamp > this.timestamp && timestamp - this.timestamp <= 250 ? this.timestamp : null;
    [this.current, this.previous] = [this.previous, this.current];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        this.current[y * width + x] = rgba[((height - 1 - y) * width + x) * 4] >= 128 ? 1 : 0;
      }
    }
    this.timestamp = timestamp;
  }

  occupied(x: number, y: number, radius = 0): boolean {
    if (![x, y, radius].every(Number.isFinite) || radius < 0 || x < 0 || x > 1 || y < 0 || y > 1 || this.timestamp === null) return false;
    if (radius > 0) return this.coverage({ x: x - radius, y: y - radius, width: radius * 2, height: radius * 2 }) > 0;
    return this.current[Math.min(this.height - 1, Math.floor(y * this.height)) * this.width + Math.min(this.width - 1, Math.floor(x * this.width))] === 1;
  }

  coverage(region: CameraRect): number {
    const bounds = this.bounds(region);
    if (!bounds || this.timestamp === null) return 0;
    let occupied = 0;
    for (let y = bounds.top; y < bounds.bottom; y++) {
      for (let x = bounds.left; x < bounds.right; x++) occupied += this.current[y * this.width + x];
    }
    return occupied / ((bounds.right - bounds.left) * (bounds.bottom - bounds.top));
  }

  motion(region: CameraRect = { x: 0, y: 0, width: 1, height: 1 }): MaskMotion {
    const bounds = this.bounds(region);
    if (!bounds || this.timestamp === null || this.previousTime === null) return { changed: 0, velocity: null, intervalMs: 0 };
    let changed = 0, count = 0, oldCount = 0, sx = 0, sy = 0, ox = 0, oy = 0;
    for (let y = bounds.top; y < bounds.bottom; y++) {
      for (let x = bounds.left; x < bounds.right; x++) {
        const index = y * this.width + x;
        const current = this.current[index], previous = this.previous[index];
        changed += current !== previous ? 1 : 0;
        count += current; oldCount += previous;
        sx += current * (x + 0.5); sy += current * (y + 0.5);
        ox += previous * (x + 0.5); oy += previous * (y + 0.5);
      }
    }
    const intervalMs = this.timestamp - this.previousTime;
    // A regional centroid estimate, not optical flow or individual toy tracking.
    // Entry/exit, deformation and multiple objects can bias this estimate.
    const velocity = count >= 2 && oldCount >= 2 ? {
      x: (sx / count - ox / oldCount) / this.width * 1000 / intervalMs,
      y: (sy / count - oy / oldCount) / this.height * 1000 / intervalMs,
    } : null;
    return { changed: changed / ((bounds.right - bounds.left) * (bounds.bottom - bounds.top)), velocity, intervalMs };
  }

  // Debug-only, caller-owned copy; gameplay should use the queries above.
  pixels(): Uint8Array { return this.current.slice(); }

  private bounds(region: CameraRect): { left: number; top: number; right: number; bottom: number } | null {
    if (!Object.values(region).every(Number.isFinite) || region.width <= 0 || region.height <= 0 || !this.width || !this.height) return null;
    const left = Math.max(0, Math.floor(region.x * this.width));
    const top = Math.max(0, Math.floor(region.y * this.height));
    const right = Math.min(this.width, Math.ceil((region.x + region.width) * this.width));
    const bottom = Math.min(this.height, Math.ceil((region.y + region.height) * this.height));
    return left < right && top < bottom ? { left, top, right, bottom } : null;
  }
}
