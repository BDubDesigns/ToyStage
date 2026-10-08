import { PoseFrameGate } from "./pose-protocol";
import type { FrameToken, PoseWorkerRequest, PoseWorkerResponse } from "./pose-protocol";
import { PoseSmoother } from "./pose-smoothing";
import { isPoseFresh, POSE_FRESH_MS } from "./pose-types";
import type { ImageLandmark, PoseFrame, PoseLayout } from "./pose-types";

// Benchmark-only raw observations never enter the production 33-joint snapshots.
export interface PoseObservation {
  readonly token: FrameToken;
  readonly landmarks: readonly (readonly ImageLandmark[])[];
  readonly receivedAt: number;
  readonly inferenceMs: number;
  readonly captureMs: number;
  readonly roundTripMs: number;
}

export interface PoseWorkerPort {
  onmessage: ((event: MessageEvent<PoseWorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  postMessage(message: PoseWorkerRequest, transfer?: Transferable[]): void;
  terminate(): void;
}

interface TrackerOptions {
  workerFactory?: () => PoseWorkerPort;
  capture?: (video: HTMLVideoElement, options: ImageBitmapOptions) => Promise<ImageBitmap>;
  now?: () => number;
  timeOrigin?: number;
  assetsUrl?: string;
  rawOnly?: boolean;
  onObservation?: (observation: PoseObservation) => void;
  onAttempt?: (now: number, outcome: PoseFrameGate["lastOutcome"]) => void;
}

export interface PoseDiagnostics {
  readonly state: "off" | "loading" | "ready" | "error" | "unsupported";
  readonly error: string;
  readonly samplesHz: number;
  readonly inferenceMs: number;
  readonly captureMs: number;
  readonly roundTripMs: number;
  readonly skipped: number;
  readonly busy: boolean;
  readonly sampleWidth: number;
  readonly sampleHeight: number;
  readonly backend: string;
  readonly blockedNetworkRequests: number;
}

export function getPoseSampleSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, 512 / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export class PoseTracker {
  private worker: PoseWorkerPort | null = null;
  private readonly gate = new PoseFrameGate();
  private readonly smoother = new PoseSmoother();
  private frame: PoseFrame | null = null;
  private state: PoseDiagnostics["state"] = "off";
  private error = "";
  private accepting = false;
  private layout: PoseLayout = { rect: { x: 0, y: 0, width: 1, height: 1 }, mirrored: false };
  private sent: { token: FrameToken; at: number; captureMs: number } | null = null;
  private timeout: ReturnType<typeof setTimeout> | null = null;
  private count = 0;
  private statsStart = 0;
  private samplesHz = 0;
  private inferenceMs = 0;
  private captureMs = 0;
  private roundTripMs = 0;
  private sampleWidth = 0;
  private sampleHeight = 0;
  private readonly now: () => number;
  private backend = "CPU worker";
  private blockedNetworkRequests = 0;

  constructor(private readonly options: TrackerOptions = {}) {
    this.now = options.now ?? (() => performance.now());
  }

  start(): void {
    if (this.worker) return;
    this.stop();
    this.error = "";
    if (!this.options.workerFactory && (typeof Worker === "undefined" || typeof createImageBitmap === "undefined" || typeof OffscreenCanvas === "undefined")) {
      this.state = "unsupported";
      this.error = "Pose Mode needs a browser with workers, ImageBitmap and OffscreenCanvas. Try a recent Chrome or Edge.";
      return;
    }
    this.state = "loading";
    this.accepting = true;
    this.statsStart = this.now();
    try {
      const worker: PoseWorkerPort = this.options.workerFactory?.() ?? new Worker(new URL("./pose-worker.ts", import.meta.url), { type: "module" });
      this.worker = worker;
      worker.onmessage = (event) => { if (this.worker === worker) this.receive(event.data); };
      worker.onerror = (event) => { event.preventDefault(); if (this.worker === worker) this.fail(event.message || "Pose worker failed."); };
      worker.onmessageerror = () => { if (this.worker === worker) this.fail("Could not read the pose worker response."); };
      this.timeout = setTimeout(() => this.fail("Pose model took too long to load. Check your connection, then retry."), 30000);
      const assetsUrl = this.options.assetsUrl ?? new URL(`${import.meta.env.BASE_URL}pose/`, location.href).href;
      worker.postMessage({ type: "init", assetsUrl });
    } catch (error) { this.fail(error instanceof Error ? error.message : "Could not start the pose worker."); }
  }

  private clearTimeout(): void {
    if (this.timeout !== null) clearTimeout(this.timeout);
    this.timeout = null;
  }

  private receive(message: PoseWorkerResponse): void {
    if (message.type === "error") { this.fail(message.message); if (message.unsupported) this.state = "unsupported"; return; }
    if (message.type === "ready") { this.clearTimeout(); this.state = "ready"; this.backend = message.backend ?? "CPU worker"; return; }
    const sent = this.sent;
    // An unknown/out-of-order result must not release another frame's slot.
    if (!sent || sent.token.frameId !== message.token.frameId || sent.token.generation !== message.token.generation) return;
    this.sent = null;
    this.clearTimeout();
    const current = this.gate.complete(message.token);
    const now = this.now();
    if (!current || !this.accepting) return;
    this.count++;
    this.blockedNetworkRequests = message.blockedNetworkRequests ?? this.blockedNetworkRequests;
    const average = (old: number, value: number) => old ? old * 0.8 + value * 0.2 : value;
    this.inferenceMs = average(this.inferenceMs, message.inferenceMs);
    this.captureMs = average(this.captureMs, sent.captureMs);
    this.roundTripMs = average(this.roundTripMs, now - sent.at);
    this.options.onObservation?.({ token: message.token, landmarks: message.landmarks, receivedAt: now,
      inferenceMs: message.inferenceMs, captureMs: sent.captureMs, roundTripMs: now - sent.at });
    if (this.options.rawOnly) return;
    if (now - message.token.capturedAt > POSE_FRESH_MS) { this.clearHistory(); return; }
    const poses = message.landmarks.slice(0, 1).map((landmarks) => this.smoother.update(landmarks, message.token.capturedAt, this.layout));
    if (!poses.length) this.smoother.reset();
    this.frame = Object.freeze({
      frameId: message.token.frameId, capturedAt: message.token.capturedAt, mediaTime: message.token.mediaTime,
      receivedAt: now, completedAt: message.completedAtEpoch - (this.options.timeOrigin ?? performance.timeOrigin),
      inferenceMs: message.inferenceMs, captureMs: sent.captureMs, roundTripMs: now - sent.at,
      poses: Object.freeze(poses),
    });
  }

  sample(video: HTMLVideoElement, now: number, mediaTime: number): void {
    if (this.state !== "ready" || !this.accepting || !this.worker || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;
    const token = this.gate.reserve(now, mediaTime);
    this.options.onAttempt?.(now, this.gate.lastOutcome);
    if (!token) return;
    const worker = this.worker;
    const size = getPoseSampleSize(video.videoWidth, video.videoHeight);
    this.sampleWidth = size.width; this.sampleHeight = size.height;
    const capture = this.options.capture ?? ((source, options) => createImageBitmap(source, options));
    // Includes capture in the busy interval. No promise/frame queue accumulates.
    this.clearTimeout();
    this.timeout = setTimeout(() => this.fail("Pose sampling stopped responding. Retry Pose Mode."), 5000);
    void (async () => {
      let bitmap: ImageBitmap | null = null;
      try {
        bitmap = await capture(video, { resizeWidth: size.width, resizeHeight: size.height, resizeQuality: "low" });
        if (this.worker !== worker || !this.accepting || !this.gate.isCurrent(token)) {
          if (this.worker === worker) { this.gate.complete(token); this.clearTimeout(); }
          return;
        }
        const at = this.now();
        this.sent = { token, at, captureMs: at - token.capturedAt };
        worker.postMessage({ type: "frame", token, bitmap }, [bitmap]);
        bitmap = null; // Ownership transferred; worker closes it in finally.
      } catch (error) {
        if (this.worker === worker && this.gate.isCurrent(token)) this.fail(error instanceof Error ? error.message : "Could not sample the camera.");
        else if (this.worker === worker) { this.gate.complete(token); this.clearTimeout(); }
      } finally { bitmap?.close(); }
    })();
  }

  setLayout(layout: PoseLayout): void {
    const a = this.layout, b = layout;
    if (a.mirrored === b.mirrored && a.rect.x === b.rect.x && a.rect.y === b.rect.y && a.rect.width === b.rect.width && a.rect.height === b.rect.height) return;
    this.layout = Object.freeze({ rect: Object.freeze({ ...layout.rect }), mirrored: layout.mirrored });
    this.invalidate();
  }

  private clearHistory(): void { this.frame = null; this.smoother.reset(); }
  invalidate(): void { this.gate.invalidate(); this.clearHistory(); }
  pause(): void { this.accepting = false; this.invalidate(); this.samplesHz = this.count = 0; }
  resume(): void { this.accepting = true; this.statsStart = this.now(); this.invalidate(); }

  snapshot(now = this.now()): PoseFrame | null {
    if (!isPoseFresh(this.frame, now)) this.clearHistory();
    return this.frame;
  }

  diagnostics(now = this.now()): PoseDiagnostics {
    if (now - this.statsStart >= 1000) {
      this.samplesHz = this.count * 1000 / (now - this.statsStart);
      this.count = 0; this.statsStart = now;
    }
    return Object.freeze({ state: this.state, error: this.error, samplesHz: this.samplesHz,
      inferenceMs: this.inferenceMs, captureMs: this.captureMs, roundTripMs: this.roundTripMs,
      skipped: this.gate.skipped, busy: this.gate.busy, sampleWidth: this.sampleWidth, sampleHeight: this.sampleHeight, backend: this.backend,
      blockedNetworkRequests: this.blockedNetworkRequests });
  }

  private fail(message: string): void { this.stop(); this.state = "error"; this.error = message; }

  stop(): void {
    this.clearTimeout();
    if (this.worker) {
      this.worker.onmessage = this.worker.onerror = this.worker.onmessageerror = null;
      this.worker.terminate();
      this.worker = null;
    }
    this.accepting = false;
    this.gate.stop(); this.sent = null; this.clearHistory();
    this.state = "off";
    this.count = this.samplesHz = this.inferenceMs = this.captureMs = this.roundTripMs = 0;
    this.sampleWidth = this.sampleHeight = 0;
    this.blockedNetworkRequests = 0;
  }
}
