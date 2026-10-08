import type { CameraRect } from "../compositor-layout";

// MediaPipe anatomical sides remain anatomical sides even in a mirrored view.
export const JOINT = Object.freeze({
  nose: 0, leftEyeInner: 1, leftEye: 2, leftEyeOuter: 3,
  rightEyeInner: 4, rightEye: 5, rightEyeOuter: 6, leftEar: 7, rightEar: 8,
  leftMouth: 9, rightMouth: 10, leftShoulder: 11, rightShoulder: 12,
  leftElbow: 13, rightElbow: 14, leftWrist: 15, rightWrist: 16,
  leftPinky: 17, rightPinky: 18, leftIndex: 19, rightIndex: 20,
  leftThumb: 21, rightThumb: 22, leftHip: 23, rightHip: 24,
  leftKnee: 25, rightKnee: 26, leftAnkle: 27, rightAnkle: 28,
  leftHeel: 29, rightHeel: 30, leftFoot: 31, rightFoot: 32,
});

// Body-only drawing topology; face landmarks are exposed without a face mesh.
export const BODY_CONNECTIONS: readonly (readonly [number, number])[] = Object.freeze([
  [11, 12], [11, 23], [12, 24], [23, 24],
  [11, 13], [13, 15], [15, 19], [12, 14], [14, 16], [16, 20],
  [23, 25], [25, 27], [27, 29], [29, 31], [27, 31],
  [24, 26], [26, 28], [28, 30], [30, 32], [28, 32],
].map((pair) => Object.freeze(pair as [number, number])));

export const POSE_FRESH_MS = 300;
export const JOINT_CONFIDENCE = 0.5;

export interface ImageLandmark {
  readonly x: number;
  readonly y: number;
  readonly z?: number;
  readonly visibility?: number;
  readonly presence?: number;
}

export type JointReliability = "reliable" | "invalid" | "missing-confidence" | "low-visibility" | "low-presence";

export interface PoseLandmark {
  readonly x: number; // Smoothed, stage normalized. Deliberately not clamped.
  readonly y: number;
  readonly vx: number; // Stage widths / second; NOT shorter-edge ball units.
  readonly vy: number; // Stage heights / second.
  readonly raw: ImageLandmark; // Unmirrored model/image coordinates and depth.
  readonly reliable: boolean;
  readonly reliability: JointReliability;
}

export interface Pose {
  readonly landmarks: readonly PoseLandmark[]; // Always MediaPipe's ordered 33.
  readonly state: "tracked" | "partial" | "unusable"; // Derived, not model confidence.
}

export interface PoseFrame {
  readonly frameId: number;
  readonly capturedAt: number; // Main performance.now() at bitmap capture START.
  readonly mediaTime: number; // Video media clock, seconds; used only for deduplication.
  readonly completedAt: number; // Worker timeOrigin + now, converted to main time origin.
  readonly receivedAt: number; // Main performance.now() at message receipt.
  readonly inferenceMs: number;
  readonly captureMs: number; // Async bitmap creation/downscale wall time.
  readonly roundTripMs: number; // Send → receipt; includes inference, scheduling and transport.
  readonly poses: readonly Pose[];
}

export interface PoseLayout {
  readonly rect: Readonly<CameraRect>;
  readonly mirrored: boolean;
}

export function mapImagePoint(point: ImageLandmark, layout: PoseLayout): { x: number; y: number } {
  return {
    x: layout.rect.x + (layout.mirrored ? 1 - point.x : point.x) * layout.rect.width,
    y: layout.rect.y + point.y * layout.rect.height,
  };
}

export function jointReliability(point: ImageLandmark): JointReliability {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return "invalid";
  if (point.visibility === undefined || !Number.isFinite(point.visibility)) return "missing-confidence";
  if (point.visibility < JOINT_CONFIDENCE) return "low-visibility";
  if (point.presence !== undefined && (!Number.isFinite(point.presence) || point.presence < JOINT_CONFIDENCE)) return "low-presence";
  return "reliable";
}

export function isPoseFresh(frame: PoseFrame | null, now: number): frame is PoseFrame {
  return frame !== null && now >= frame.capturedAt && now - frame.capturedAt <= POSE_FRESH_MS;
}
