import { blockedNetworkRequests } from "./worker-network-policy";
import * as tf from "@tensorflow/tfjs-core";
import { setWasmPaths, setThreadsCount } from "@tensorflow/tfjs-backend-wasm";
// Import just MoveNet, not the package entry's unrelated detector runtimes.
import { load } from "@tensorflow-models/pose-detection/dist/movenet/detector";
import type { PoseDetector } from "@tensorflow-models/pose-detection";
import type { PoseWorkerRequest, PoseWorkerResponse } from "./pose-protocol";

const send = (message: PoseWorkerResponse) => self.postMessage(message);
let detector: PoseDetector | null = null;
let canvas: OffscreenCanvas | null = null;
let busy = false;

async function initialize(assetsUrl: string): Promise<void> {
  if (busy || detector) return;
  busy = true;
  try {
    const base = new URL("../movenet/", assetsUrl);
    if (base.origin !== self.location.origin) throw new Error("Benchmark assets must be same-origin.");
    if (typeof OffscreenCanvas === "undefined" || typeof WebAssembly === "undefined") throw new Error("MoveNet needs worker OffscreenCanvas and WebAssembly.");
    // Single-thread SIMD/plain WASM works without cross-origin isolation. There
    // is no automatic CPU/WebGL/main-thread fallback and no nested worker pool.
    setThreadsCount(1);
    tf.env().set("WASM_HAS_MULTITHREAD_SUPPORT", false);
    setWasmPaths(new URL("wasm/", base).href);
    if (!await tf.setBackend("wasm")) throw new Error("TensorFlow.js WASM backend initialization failed.");
    await tf.ready();
    detector = await load({ modelType: "SinglePose.Lightning", modelUrl: new URL("model.json", base).href, enableSmoothing: false });
    canvas = new OffscreenCanvas(1, 1);
    send({ type: "ready", backend: `WASM ${await tf.env().getAsync("WASM_HAS_SIMD_SUPPORT") ? "SIMD" : "plain"} worker, 1 thread` });
  } catch (error) {
    detector?.dispose(); detector = null;
    send({ type: "error", unsupported: true, message: `MoveNet worker unavailable: ${error instanceof Error ? error.message : "initialization failed"}` });
  } finally { busy = false; }
}

async function infer(message: Extract<PoseWorkerRequest, { type: "frame" }>): Promise<void> {
  let input: tf.Tensor3D | null = null;
  try {
    if (!detector || !canvas || busy) throw new Error("MoveNet worker is not ready or already busy.");
    busy = true;
    const start = performance.now(), { width, height } = message.bitmap;
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Worker Canvas 2D is unavailable.");
    ctx.drawImage(message.bitmap, 0, 0);
    const rgba = ctx.getImageData(0, 0, width, height).data;
    // Bounded <=512 capture readback is entirely in this worker. Explicit RGB
    // tensor avoids DOM/video assumptions in TF.js fromPixels inside a worker.
    const rgb = new Int32Array(width * height * 3);
    for (let i = 0, j = 0; i < rgba.length; i += 4) { rgb[j++] = rgba[i]; rgb[j++] = rgba[i + 1]; rgb[j++] = rgba[i + 2]; }
    input = tf.tensor3d(rgb, [height, width, 3], "int32");
    const poses = await detector.estimatePoses(input, { flipHorizontal: false }, message.token.capturedAt);
    send({ type: "result", token: message.token,
      landmarks: poses.slice(0, 1).map(pose => pose.keypoints.map(point => ({ x: point.x / width, y: point.y / height, visibility: point.score }))),
      inferenceMs: performance.now() - start, completedAtEpoch: performance.timeOrigin + performance.now(), blockedNetworkRequests: blockedNetworkRequests() });
  } catch (error) {
    detector?.dispose(); detector = null;
    send({ type: "error", message: `MoveNet inference failed: ${error instanceof Error ? error.message : "unknown error"}` });
  } finally { input?.dispose(); message.bitmap.close(); busy = false; }
}

self.onmessage = (event: MessageEvent<PoseWorkerRequest>) => {
  if (event.data.type === "init") void initialize(event.data.assetsUrl);
  else void infer(event.data);
};
