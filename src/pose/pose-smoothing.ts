import { jointReliability, mapImagePoint, POSE_FRESH_MS } from "./pose-types";
import type { ImageLandmark, Pose, PoseLandmark, PoseLayout } from "./pose-types";

interface History { x: number; y: number; at: number }
const CORE = [11, 12, 23, 24];
const BODY = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

export class PoseSmoother {
  private history: (History | null)[] = [];

  reset(): void { this.history = []; }

  update(raw: readonly ImageLandmark[], capturedAt: number, layout: PoseLayout): Pose {
    const landmarks: PoseLandmark[] = Array.from({ length: 33 }, (_, i) => {
      const source = Object.freeze({ ...(raw[i] ?? { x: NaN, y: NaN }) });
      const reliability = jointReliability(source);
      const reliable = reliability === "reliable";
      const mapped = mapImagePoint(source, layout);
      let x = mapped.x, y = mapped.y, vx = 0, vy = 0;
      const previous = this.history[i];
      const dtMs = previous ? capturedAt - previous.at : 0;
      const distance = previous ? Math.hypot(x - previous.x, y - previous.y) : 0;
      // Seed on gaps, reacquisition and teleports. Never infer a strike from them.
      if (reliable && previous && dtMs >= 16 && dtMs <= POSE_FRESH_MS && distance <= 0.25) {
        const confidence = Math.min(source.visibility ?? 0, source.presence ?? 1);
        const alpha = 1 - Math.exp(-dtMs / (confidence >= 0.8 ? 45 : 75));
        x = previous.x + (x - previous.x) * alpha;
        y = previous.y + (y - previous.y) * alpha;
        if (dtMs <= 150) {
          vx = (x - previous.x) / (dtMs / 1000);
          vy = (y - previous.y) / (dtMs / 1000);
          if (Math.hypot(vx, vy) > 6) vx = vy = 0;
        }
      }
      this.history[i] = reliable ? { x, y, at: capturedAt } : null;
      return Object.freeze({ x, y, vx, vy, raw: source, reliable, reliability });
    });
    const core = CORE.filter((i) => landmarks[i].reliable).length;
    const body = BODY.filter((i) => landmarks[i].reliable).length;
    const state = core < 2 || body < 4 ? "unusable" : core === 4 && body === BODY.length ? "tracked" : "partial";
    if (state === "unusable") this.reset();
    return Object.freeze({ landmarks: Object.freeze(landmarks), state });
  }
}
