import { blockedNetworkRequests } from "./worker-network-policy";
import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import type { PoseWorkerRequest, PoseWorkerResponse } from "./pose-protocol";

const send = (message: PoseWorkerResponse) => self.postMessage(message);
let landmarker: PoseLandmarker | null = null;
let initializing = false;

async function initialize(assetsUrl: string): Promise<void> {
  if (landmarker || initializing) return;
  initializing = true;
  try {
    const base = new URL(assetsUrl);
    if (base.origin !== self.location.origin) throw new Error("Pose assets must be same-origin.");
    if (typeof OffscreenCanvas === "undefined") throw new Error("This browser needs worker OffscreenCanvas for Pose Mode.");
    if (!await FilesetResolver.isSimdSupported()) throw new Error("Pose Mode needs WebAssembly SIMD. Try a recent browser.");
    // 1.1.0 supplies a native module loader. Keep it byte-identical to the package.
    const fileset = await FilesetResolver.forVisionTasks(new URL("wasm", base).href, true);
    landmarker = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: new URL("pose_landmarker_lite-float16-v1.task", base).href, delegate: "CPU" },
      runningMode: "VIDEO", numPoses: 1, outputSegmentationMasks: false,
      minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
    });
    send({ type: "ready" });
  } catch (error) {
    landmarker?.close();
    landmarker = null;
    send({ type: "error", message: error instanceof Error ? error.message : "Pose model could not load." });
  } finally { initializing = false; }
}

self.onmessage = (event: MessageEvent<PoseWorkerRequest>) => {
  const message = event.data;
  if (message.type === "init") { void initialize(message.assetsUrl); return; }
  try {
    if (!landmarker) throw new Error("Pose worker is not ready.");
    const start = performance.now();
    const result = landmarker.detectForVideo(message.bitmap, message.token.capturedAt);
    send({ type: "result", token: message.token, landmarks: result.landmarks,
      inferenceMs: performance.now() - start, completedAtEpoch: performance.timeOrigin + performance.now(), blockedNetworkRequests: blockedNetworkRequests() });
  } catch (error) {
    send({ type: "error", message: error instanceof Error ? error.message : "Pose inference failed." });
  } finally {
    message.bitmap.close();
  }
};
