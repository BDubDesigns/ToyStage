import { afterEach, describe, expect, it, vi } from "vitest";
import { commonPose, COMMON_JOINTS } from "./benchmark-joints";
import { BenchmarkMetrics, distribution } from "./benchmark-metrics";
import { BenchmarkSession } from "./benchmark-session";
import type { BenchmarkUpdate } from "./benchmark-session";
import type { PoseObservation, PoseWorkerPort } from "./pose-tracker";
import type { PoseWorkerRequest, PoseWorkerResponse } from "./pose-protocol";
import type { ImageLandmark } from "./pose-types";
import { getCameraRect } from "../compositor-layout";

const layout = { rect: { x: 0.1, y: 0.2, width: 0.8, height: 0.6 }, mirrored: true };
const landmarks = (count = 33): ImageLandmark[] => Array.from({ length: count }, () => ({ x: 0.2, y: 0.3, visibility: 0.9, presence: 0.9 }));
const pose = () => commonPose("mediapipe", landmarks(), layout);
function observation(capture: number, receipt = capture + 50, inferenceMs = 40): PoseObservation {
  return { token: { generation: 0, frameId: capture, capturedAt: capture, mediaTime: capture / 1000 },
    receivedAt: receipt, inferenceMs, captureMs: 5, roundTripMs: receipt - capture - 5, landmarks: [landmarks()] };
}

describe("common benchmark joints", () => {
  it.each(["mediapipe", "movenet"] as const)("maps %s anatomical joints once through the existing mirror/aspect mapping", model => {
    const source = landmarks(model === "mediapipe" ? 33 : 17);
    source[model === "mediapipe" ? 15 : 9] = { x: 0.1, y: 0.8, visibility: 0.8 };
    const result = commonPose(model, source, layout);
    expect(result.joints.map(joint => joint.name)).toEqual(COMMON_JOINTS);
    expect(result.joints[5]).toMatchObject({ name: "leftWrist", reliable: true });
    expect(result.joints[5].x).toBeCloseTo(0.82);
    expect(result.joints[5].y).toBeCloseTo(0.68);
    expect(commonPose(model, source, { ...layout, mirrored: false }).joints[5].x).toBeCloseTo(0.18);
  });
  it.each([[720, 1280], [1280, 720]])("uses the same contain rect for %s × %s", (w, h) => {
    const rect = getCameraRect(w, h, h, w);
    const result = commonPose("movenet", landmarks(17), { rect, mirrored: false });
    expect(result.joints[0].x).toBeCloseTo(rect.x + 0.2 * rect.width);
    expect(result.joints[0].y).toBeCloseTo(rect.y + 0.3 * rect.height);
  });
  it("rejects missing/low confidence, offscreen and malformed data without synthesizing absent details", () => {
    const points = landmarks(17);
    points[0] = { x: 0.2, y: 0.3 };
    points[9] = { x: 0.3, y: 0.4, visibility: 0.49 };
    points[10] = { x: 1.1, y: 0.3, visibility: 1 };
    points[15] = { x: NaN, y: 0.3, visibility: 1 };
    const result = commonPose("movenet", points, layout);
    for (const i of [0, 5, 6, 11]) expect(result.joints[i].reliable).toBe(false);
    expect(result.joints).toHaveLength(13);
    expect(commonPose("mediapipe", points, layout)).toMatchObject({ invalid: true, usable: false });
    expect(commonPose("movenet", undefined, layout)).toMatchObject({ present: false, usable: false });
    expect(commonPose("mediapipe", landmarks().map(p => ({ ...p, presence: 0.2 })), layout).usable).toBe(false);
  });
});

describe("fixed-window observed metrics", () => {
  it("computes nearest-rank percentiles and arithmetic average, never invents missing samples", () => {
    expect(distribution([])).toEqual({ count: 0, average: null, p50: null, p95: null });
    expect(distribution([10, 40, 30, 20])).toEqual({ count: 4, average: 25, p50: 20, p95: 40 });
    expect(distribution(Array.from({ length: 100 }, (_, i) => i + 1))).toMatchObject({ p50: 50, p95: 95, average: 50.5 });
  });
  it("excludes warmup and boundary-crossing results, separates delivery from usable latency and skips", () => {
    const metrics = new BenchmarkMetrics(1000, 1000);
    metrics.attempt(999, "accepted"); metrics.observe(observation(999, 1049), pose()); metrics.render(999, 1);
    metrics.observe(observation(1950, 2001), pose());
    metrics.attempt(1000, "accepted"); metrics.attempt(1050, "backpressure"); metrics.attempt(1060, "cadence"); metrics.attempt(1070, "duplicate");
    metrics.observe(observation(1000, 1050, 40), pose());
    metrics.attempt(1200, "accepted"); metrics.observe(observation(1200, 1300, 80), commonPose("mediapipe", undefined, layout));
    metrics.render(1100, 2); metrics.render(1150, 4);
    const summary = metrics.summary(2000);
    expect(summary.inferenceMs).toEqual({ count: 2, average: 60, p50: 40, p95: 80 });
    expect(summary.captureToResultMs).toMatchObject({ count: 2, average: 75, p95: 100 });
    expect(summary.captureToUsableLandmarksMs).toMatchObject({ count: 1, average: 50 });
    expect(summary.samples).toMatchObject({ received: 2, fresh: 2, usable: 1, submitted: 2, unfinishedAtBoundary: 0 });
    expect(summary.stageFps).toBe(2); expect(summary.freshSampleHz).toBe(2); expect(summary.usablePoseHz).toBe(1);
    expect(summary.skips).toEqual({ backpressure: 1, cadence: 1, duplicateVideoFrames: 1 });
    expect(summary.stageFrameIntervalMs).toMatchObject({ count: 1, p50: 50 });
  });
  it("integrates empty startup, no-person, expiry and low-confidence time independently of render cadence", () => {
    const metrics = new BenchmarkMetrics(1000, 1000);
    metrics.observe(observation(1100, 1150), pose()); // available 1150..1400
    const low = commonPose("mediapipe", landmarks().map(p => ({ ...p, visibility: 0.1 })), layout);
    metrics.observe(observation(1600, 1650), low); // present 1650..1900, unusable
    const summary = metrics.summary(2000);
    expect(summary.noUsablePoseSeconds).toBe(0.75);
    expect(summary.noPoseSeconds).toBe(0.5);
    expect(summary.unusableFraction).toBe(0.5);
    expect(summary.reliableJointFraction.leftWrist).toBe(0.5);
  });
  it("counts stale arrivals and invalid sets; missed frames expire even when no inference completes", () => {
    const metrics = new BenchmarkMetrics(0, 1000);
    metrics.observe(observation(0, 400), pose());
    metrics.observe(observation(500, 550), commonPose("mediapipe", landmarks(17), layout));
    const summary = metrics.summary(1000);
    expect(summary.samples).toMatchObject({ stale: 1, invalid: 1, usable: 0 });
    expect(summary.staleFraction).toBe(0.5); expect(summary.invalidFraction).toBe(0.5);
    expect(summary.noUsablePoseSeconds).toBe(1);
    expect(summary.captureToUsableLandmarksMs.count).toBe(0);
  });
});

class FakeWorker implements PoseWorkerPort {
  onmessage: PoseWorkerPort["onmessage"] = null;
  onerror: PoseWorkerPort["onerror"] = null;
  onmessageerror: PoseWorkerPort["onmessageerror"] = null;
  postMessage = vi.fn<(message: PoseWorkerRequest, transfer?: Transferable[]) => void>();
  terminate = vi.fn();
  emit(message: PoseWorkerResponse) { this.onmessage?.({ data: message } as MessageEvent<PoseWorkerResponse>); }
}
const video = { readyState: 2, videoWidth: 720, videoHeight: 1280 } as HTMLVideoElement;
const geometry = { videoWidth: 720, videoHeight: 1280, stageWidth: 720, stageHeight: 961, sampleWidth: 288, sampleHeight: 512, mirrored: true };
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };
afterEach(() => vi.useRealTimers());

describe("benchmark session and inherited worker safeguards", () => {
  function setup(model: "mediapipe" | "movenet" = "mediapipe", capture = vi.fn(async () => ({ close: vi.fn() }) as unknown as ImageBitmap)) {
    let now = 0; const worker = new FakeWorker(), updates: BenchmarkUpdate[] = [];
    const session = new BenchmarkSession(model, update => updates.push(update), {
      now: () => now, workerFactory: () => worker, assetsUrl: "https://test.local/pose/", browser: "Synthetic test",
      capture, warmupMs: 1000, measurementMs: 1000,
    });
    session.setLayout(layout); session.start();
    const render = (at: number) => { now = at; session.render(at, 1, geometry, "test decoded clock"); };
    const result = (count = 33) => {
      const request = worker.postMessage.mock.calls.at(-1)![0];
      if (request.type !== "frame") throw new Error("Expected frame");
      worker.emit({ type: "result", token: request.token, landmarks: [landmarks(count)], inferenceMs: 20, completedAtEpoch: now });
    };
    return { worker, session, updates, render, result, capture, setNow: (at: number) => { now = at; } };
  }
  it("starts warmup only after readiness, excludes it and releases the worker at completion", async () => {
    const { session, worker, updates, render, result, setNow } = setup();
    render(100); expect(updates.at(-1)!.state).toBe("loading");
    worker.emit({ type: "ready" }); render(1000);
    session.sample(video, 1100, 1); setNow(1105); await tick(); setNow(1120); result();
    session.sample(video, 2100, 2); setNow(2105); await tick(); setNow(2120); result(); render(2200);
    expect(session.tracker.snapshot()).toBeNull(); // Raw-only does not create fake production poses.
    expect(session.snapshot(2120)!.usable).toBe(true);
    expect(session.snapshot(2401)).toBeNull();
    render(3000);
    expect(updates.at(-1)!.report).toMatchObject({ status: "complete", environment: { mirrored: true, orientation: "portrait" }, metrics: { measuredSeconds: 1, samples: { received: 1 } } });
    expect(worker.terminate).toHaveBeenCalledOnce();
    const calls = worker.postMessage.mock.calls.length; session.sample(video, 3200, 3); await tick();
    expect(worker.postMessage).toHaveBeenCalledTimes(calls);
    session.stop("closed"); expect(updates.filter(update => update.report)).toHaveLength(1);
  });
  it("handles a 17-joint candidate without manufacturing a 33-joint snapshot", async () => {
    const { session, worker, render, result, setNow } = setup("movenet");
    worker.emit({ type: "ready", backend: "WASM SIMD worker, 1 thread" }); render(100);
    session.sample(video, 1200, 1); setNow(1205); await tick(); setNow(1220); result(17);
    expect(session.snapshot(1220)!.joints).toHaveLength(13); expect(session.tracker.snapshot()).toBeNull();
    session.stop("switch model"); expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it.each(["hidden", "rotation", "camera switch", "mode switch"])("marks %s as interrupted and never counts the absent interval", reason => {
    const { session, worker, render, updates } = setup();
    worker.emit({ type: "ready" }); render(0); render(1200); session.stop(reason, 1500); render(99999);
    expect(updates.at(-1)!.report).toMatchObject({ status: "interrupted", reason, metrics: { measuredSeconds: 0.5 } });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it("holds one slot through slow capture and closes late bitmaps after switching", async () => {
    let resolve!: (value: ImageBitmap) => void;
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
    const capture = vi.fn(() => new Promise<ImageBitmap>(done => { resolve = done; }));
    const { session, worker, render, updates } = setup("movenet", capture);
    worker.emit({ type: "ready" }); render(0);
    session.sample(video, 1100, 1); session.sample(video, 1200, 2);
    expect(capture).toHaveBeenCalledOnce();
    session.stop("switch model", 1500); resolve(bitmap); await tick();
    expect(bitmap.close).toHaveBeenCalledOnce(); expect(worker.postMessage).toHaveBeenCalledTimes(1);
    expect(updates.at(-1)!.report!.metrics!.skips.backpressure).toBe(1);
  });
  it("reports concrete unsupported diagnostics, permits a new worker on retry", () => {
    const first = setup("movenet");
    first.worker.emit({ type: "error", unsupported: true, message: "WebAssembly unavailable" }); first.render(100);
    expect(first.updates.at(-1)!.report).toMatchObject({ status: "unsupported", reason: "WebAssembly unavailable", metrics: null });
    expect(first.worker.terminate).toHaveBeenCalledOnce();
    const second = setup("movenet"); second.worker.emit({ type: "ready" }); second.render(0);
    expect(second.updates.at(-1)!.state).toBe("warming"); second.session.stop("test end");
  });
});
