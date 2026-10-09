import { jointReliability, mapImagePoint } from "./pose-types";
import type { ImageLandmark, PoseLayout } from "./pose-types";

export type BenchmarkModel = "mediapipe" | "movenet";
// Only these 13 joints are comparable. Nose is a head pointer, not head geometry.
export const COMMON_JOINTS = ["nose", "leftShoulder", "rightShoulder", "leftElbow", "rightElbow",
  "leftWrist", "rightWrist", "leftHip", "rightHip", "leftKnee", "rightKnee", "leftAnkle", "rightAnkle"] as const;
export type CommonJointName = typeof COMMON_JOINTS[number];
const indices = { mediapipe: [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28],
  movenet: [0, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16] } as const;
export interface CommonJoint { readonly name: CommonJointName; readonly x: number; readonly y: number; readonly reliable: boolean }
export interface CommonPose { readonly joints: readonly CommonJoint[]; readonly usable: boolean; readonly invalid: boolean; readonly present: boolean }

export function commonPose(model: BenchmarkModel, landmarks: readonly ImageLandmark[] | undefined, layout: PoseLayout): CommonPose {
  if (!landmarks) return { joints: [], usable: false, invalid: false, present: false };
  const malformed = landmarks.length !== (model === "mediapipe" ? 33 : 17);
  const invalid = malformed || indices[model].some(i => !landmarks[i] || !Number.isFinite(landmarks[i].x) || !Number.isFinite(landmarks[i].y));
  const joints = COMMON_JOINTS.map((name, i) => {
    const point = landmarks[indices[model][i]];
    const reliable = !invalid && Boolean(point && jointReliability(point) === "reliable" && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1);
    return Object.freeze({ name, ...(point ? mapImagePoint(point, layout) : { x: 0, y: 0 }), reliable });
  });
  const good = (name: CommonJointName) => joints.find(joint => joint.name === name)!.reliable;
  // Shared partial-body gate; per-joint rates expose loss of head/wrists/ankles.
  const usable = joints.filter(joint => joint.reliable).length >= 4 &&
    (good("leftShoulder") || good("rightShoulder")) && (good("leftHip") || good("rightHip"));
  return Object.freeze({ joints: Object.freeze(joints), usable, invalid, present: true });
}
