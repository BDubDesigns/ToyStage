import { POSE_FRESH_MS } from "./pose-types";
import type { PoseFrame, PoseLandmark } from "./pose-types";

interface Point { x: number; y: number }

// Render-only temporal filtering. The raw, capture-stamped frame still drives
// collisions; never feed these visually projected coordinates into physics.
export class PoseVisualFilter {
  private shown: (Point | null)[] = [];
  private lastDrawAt: number | null = null;

  reset(): void { this.shown = []; this.lastDrawAt = null; }

  positions(frame: PoseFrame | null, now: number): readonly PoseLandmark[] | null {
    const pose = frame?.poses.find(p => p.state !== "unusable");
    if (!pose || !frame || now < frame.capturedAt || now - frame.capturedAt > POSE_FRESH_MS) {
      this.reset();
      return null;
    }
    const drawInterval = this.lastDrawAt === null ? 0 : Math.max(0, Math.min(100, now - this.lastDrawAt));
    this.lastDrawAt = now;
    const alpha = this.shown.length ? 1 - Math.exp(-drawInterval / 35) : 1;
    // Catch up the ~80–120 ms inference latency, without extrapolating forever
    // when the worker is busy or moving a limb an implausible distance.
    const lead = Math.min(110, Math.max(0, now - frame.capturedAt)) / 1000;
    return pose.landmarks.map((point, i) => {
      if (!point.reliable) { this.shown[i] = null; return point; }
      const dx = Number.isFinite(point.vx) ? Math.max(-0.08, Math.min(0.08, point.vx * lead)) : 0;
      const dy = Number.isFinite(point.vy) ? Math.max(-0.08, Math.min(0.08, point.vy * lead)) : 0;
      const target = { x: point.x + dx, y: point.y + dy };
      const previous = this.shown[i];
      // Don't ease across a reacquisition/teleport; never invent a limb path.
      const next = previous && Math.hypot(previous.x - target.x, previous.y - target.y) <= 0.2
        ? { x: previous.x + (target.x - previous.x) * alpha,
            y: previous.y + (target.y - previous.y) * alpha }
        : target;
      this.shown[i] = next;
      return { ...point, x: next.x, y: next.y };
    });
  }
}
