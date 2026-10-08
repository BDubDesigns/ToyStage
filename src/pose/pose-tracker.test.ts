import { afterEach, describe, expect, it, vi } from "vitest";
import { PoseFrameGate } from "./pose-protocol";
import type { PoseWorkerRequest, PoseWorkerResponse } from "./pose-protocol";
import { getPoseSampleSize, PoseTracker } from "./pose-tracker";
import type { PoseWorkerPort } from "./pose-tracker";

class FakeWorker implements PoseWorkerPort {
  onmessage: PoseWorkerPort["onmessage"] = null;
  onerror: PoseWorkerPort["onerror"] = null;
  onmessageerror: PoseWorkerPort["onmessageerror"] = null;
  postMessage = vi.fn<(message: PoseWorkerRequest, transfer?: Transferable[]) => void>();
  terminate = vi.fn();
  emit(message: PoseWorkerResponse) { this.onmessage?.({ data: message } as MessageEvent<PoseWorkerResponse>); }
}
const video = { readyState: 2, videoWidth: 1280, videoHeight: 720 } as HTMLVideoElement;
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };
const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); vi.useRealTimers(); });

function setup(capture: (video: HTMLVideoElement, options: ImageBitmapOptions) => Promise<ImageBitmap> = vi.fn(async () => ({ close: vi.fn() }) as unknown as ImageBitmap)) {
  let now = 100;
  const worker = new FakeWorker();
  const tracker = new PoseTracker({ workerFactory: () => worker, capture, now: () => now, timeOrigin: 1000, assetsUrl: "https://test.local/pose/" });
  cleanups.push(() => tracker.stop());
  tracker.start(); worker.emit({ type: "ready" });
  const result = (empty = false) => {
    const request = worker.postMessage.mock.calls.at(-1)![0];
    if (request.type !== "frame") throw new Error("Expected frame");
    worker.emit({ type: "result", token: request.token, landmarks: empty ? [] : [Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 1 }))], inferenceMs: 15, completedAtEpoch: 1000 + now - 2 });
  };
  return { worker, tracker, capture, result, setNow: (value: number) => { now = value; } };
}

describe("pose frame gate", () => {
  it("deduplicates decoded frames, caps sample rate and holds a single slot", () => {
    const gate = new PoseFrameGate();
    const first = gate.reserve(0, 0)!;
    expect(gate.reserve(70, 1)).toBeNull();
    expect(gate.complete(first)).toBe(true);
    expect(gate.reserve(80, 1)).toBeNull();
    const second = gate.reserve(80, 2)!;
    gate.complete(second);
    expect(gate.reserve(90, 3)).toBeNull();
    expect(gate.skipped).toBe(2);
  });
  it("invalidates late results without overlapping work or freeing the wrong slot", () => {
    const gate = new PoseFrameGate();
    const first = gate.reserve(0, 0)!;
    gate.invalidate();
    expect(gate.reserve(100, 1)).toBeNull();
    expect(gate.complete({ ...first, frameId: 99 })).toBe(false);
    expect(gate.busy).toBe(true);
    expect(gate.complete(first)).toBe(false);
    expect(gate.busy).toBe(false);
    expect(gate.reserve(200, 2)).not.toBeNull();
  });
  it("caps portrait and landscape captures proportionally without upscaling", () => {
    expect(getPoseSampleSize(1920, 1080)).toEqual({ width: 512, height: 288 });
    expect(getPoseSampleSize(720, 1280)).toEqual({ width: 288, height: 512 });
    expect(getPoseSampleSize(320, 240)).toEqual({ width: 320, height: 240 });
  });
});

describe("pose tracker lifecycle", () => {
  it("holds backpressure during bitmap capture and closes a late bitmap after stop", async () => {
    let resolve!: (bitmap: ImageBitmap) => void;
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
    const capture = vi.fn(() => new Promise<ImageBitmap>((done) => { resolve = done; }));
    const { tracker, worker } = setup(capture);
    tracker.sample(video, 100, 0); tracker.sample(video, 200, 1);
    expect(capture).toHaveBeenCalledTimes(1);
    const oldHandler = worker.onmessage!;
    tracker.stop(); resolve(bitmap); await tick();
    expect(bitmap.close).toHaveBeenCalledOnce();
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    expect(worker.terminate).toHaveBeenCalledOnce();
    oldHandler({ data: { type: "ready" } } as MessageEvent<PoseWorkerResponse>);
    expect(tracker.diagnostics().state).toBe("off");
    expect(tracker.snapshot()).toBeNull();
  });
  it("publishes frozen timestamps and separate capture/inference costs", async () => {
    const { tracker, result, setNow } = setup();
    tracker.setLayout({ rect: { x: 0.1, y: 0.2, width: 0.8, height: 0.6 }, mirrored: true });
    tracker.sample(video, 100, 2.5); setNow(105); await tick(); setNow(130); result();
    const frame = tracker.snapshot()!;
    expect(frame).toMatchObject({ capturedAt: 100, mediaTime: 2.5, completedAt: 128, receivedAt: 130, captureMs: 5, inferenceMs: 15, roundTripMs: 25 });
    expect(frame.poses[0].landmarks[0].x).toBe(0.5);
    expect(Object.isFrozen(frame)).toBe(true);
    expect(Object.isFrozen(frame.poses)).toBe(true);
  });
  it("closes locally owned bitmaps when transfer fails and releases the failed worker", async () => {
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
    const { tracker, worker } = setup(async () => bitmap);
    worker.postMessage.mockImplementation(() => { throw new Error("Transfer failed"); });
    tracker.sample(video, 100, 0); await tick();
    expect(bitmap.close).toHaveBeenCalledOnce();
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(tracker.diagnostics()).toMatchObject({ state: "error", error: "Transfer failed", busy: false });
  });
  it("drops results across hidden/resize invalidation and seeds resume", async () => {
    const { tracker, worker, result, setNow } = setup();
    tracker.sample(video, 100, 0); await tick();
    tracker.pause(); setNow(150); result();
    expect(tracker.snapshot()).toBeNull();
    tracker.resume(); tracker.sample(video, 200, 1); setNow(205); await tick(); setNow(220); result();
    expect(tracker.snapshot()!.poses[0].landmarks[15].vx).toBe(0);
    expect(worker.postMessage).toHaveBeenCalledTimes(3);
  });
  it("clears empty/stale results and rejects stale-at-arrival frames", async () => {
    const { tracker, result, setNow } = setup();
    tracker.sample(video, 100, 0); await tick(); setNow(130); result();
    setNow(401); expect(tracker.snapshot()).toBeNull();
    tracker.sample(video, 500, 1); setNow(501); await tick(); setNow(850); result();
    expect(tracker.snapshot()).toBeNull();
    tracker.sample(video, 900, 2); setNow(901); await tick(); setNow(920); result(true);
    expect(tracker.snapshot()!.poses).toEqual([]);
  });
  it("ignores unknown responses while retaining the real in-flight frame", async () => {
    const { tracker, worker, result } = setup();
    tracker.sample(video, 100, 0); await tick();
    worker.emit({ type: "result", token: { frameId: 99, generation: 0, capturedAt: 100, mediaTime: 0 }, landmarks: [], inferenceMs: 1, completedAtEpoch: 1100 });
    expect(tracker.diagnostics().busy).toBe(true);
    result(); expect(tracker.diagnostics().busy).toBe(false);
  });
  it("terminates failures and permits retry without main-thread inference", () => {
    const { tracker, worker } = setup();
    worker.emit({ type: "error", message: "WASM failed" });
    expect(tracker.diagnostics()).toMatchObject({ state: "error", error: "WASM failed", busy: false });
    expect(worker.terminate).toHaveBeenCalledOnce();
    tracker.start(); expect(tracker.diagnostics().state).toBe("loading");
  });
  it("times out wedged initialization and cancels its timeout on stop", () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const tracker = new PoseTracker({ workerFactory: () => worker, assetsUrl: "https://test.local/pose/" });
    cleanups.push(() => tracker.stop());
    tracker.start(); vi.advanceTimersByTime(30000);
    expect(tracker.diagnostics().state).toBe("error");
    tracker.start(); tracker.stop(); vi.advanceTimersByTime(30000);
    expect(tracker.diagnostics().state).toBe("off");
  });
});
