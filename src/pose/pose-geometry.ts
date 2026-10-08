import { JOINT } from "./pose-types";
import type { Pose } from "./pose-types";

// Shared visual/input geometry, in shorter-stage-edge units. No game rules.
export function headRadius(pose: Pose, scaleX: number, scaleY: number): number {
  const left = pose.landmarks[JOINT.leftShoulder], right = pose.landmarks[JOINT.rightShoulder];
  const span = Math.hypot((left.x - right.x) / scaleX, (left.y - right.y) / scaleY);
  return Math.max(0.02, Math.min(0.07, span * 0.23));
}
