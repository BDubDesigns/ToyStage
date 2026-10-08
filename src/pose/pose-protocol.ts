import type { ImageLandmark } from "./pose-types";

export interface FrameToken {
  readonly generation: number;
  readonly frameId: number;
  readonly capturedAt: number;
  readonly mediaTime: number;
}

export type PoseWorkerRequest =
  | { type: "init"; assetsUrl: string }
  | { type: "frame"; token: FrameToken; bitmap: ImageBitmap };

export type PoseWorkerResponse =
  | { type: "ready"; backend?: string }
  | { type: "error"; message: string; unsupported?: boolean }
  | { type: "result"; token: FrameToken; landmarks: ImageLandmark[][]; inferenceMs: number; completedAtEpoch: number; blockedNetworkRequests?: number };

// One slot covers BOTH async capture and worker inference. Invalidation keeps
// the old slot occupied until its capture/result finishes, never overlapping work.
export class PoseFrameGate {
  private generation = 0;
  private frameId = 0;
  private lastMediaTime = -1;
  private lastSample = -Infinity;
  private pending: FrameToken | null = null;
  skipped = 0;
  lastOutcome: "accepted" | "duplicate" | "backpressure" | "cadence" = "duplicate";

  reserve(now: number, mediaTime: number): FrameToken | null {
    this.lastOutcome = "duplicate";
    if (!Number.isFinite(mediaTime) || mediaTime === this.lastMediaTime) return null;
    this.lastMediaTime = mediaTime;
    if (this.pending || now - this.lastSample < 1000 / 18) {
      this.lastOutcome = this.pending ? "backpressure" : "cadence";
      this.skipped++; return null;
    }
    this.lastOutcome = "accepted";
    this.lastSample = now;
    return this.pending = Object.freeze({ generation: this.generation, frameId: ++this.frameId, capturedAt: now, mediaTime });
  }

  isCurrent(token: FrameToken): boolean {
    return token.generation === this.generation && this.matches(token);
  }

  private matches(token: FrameToken): boolean {
    return this.pending?.frameId === token.frameId && this.pending.generation === token.generation;
  }

  complete(token: FrameToken): boolean {
    if (!this.matches(token)) return false;
    const current = this.isCurrent(token);
    this.pending = null;
    return current;
  }

  invalidate(): void { this.generation++; this.lastMediaTime = -1; this.lastSample = -Infinity; }
  stop(): void { this.invalidate(); this.pending = null; this.skipped = 0; }
  get busy(): boolean { return this.pending !== null; }
}
