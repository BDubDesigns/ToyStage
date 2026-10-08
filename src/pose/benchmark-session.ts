import { commonPose } from "./benchmark-joints";
import type { BenchmarkModel, CommonPose } from "./benchmark-joints";
import { BenchmarkMetrics } from "./benchmark-metrics";
import { PoseTracker } from "./pose-tracker";
import type { PoseDiagnostics, PoseWorkerPort } from "./pose-tracker";
import type { PoseLayout } from "./pose-types";
import { POSE_FRESH_MS } from "./pose-types";

export const BENCHMARK_MODELS = {
  mediapipe: { name: "A · MediaPipe Lite", version: "tasks-vision 1.1.0 / Lite float16 v1", backend: "CPU worker", modelInput: "256 × 256 (model preprocessing)" },
  movenet: { name: "B · MoveNet Lightning", version: "pose-detection 2.1.3 / TF.js 4.22.0 / Lightning float16 v4", backend: "WASM worker, 1 thread", modelInput: "192 × 192 (model crop)" },
} as const;
export interface BenchmarkGeometry {
  videoWidth: number; videoHeight: number; stageWidth: number; stageHeight: number;
  sampleWidth: number; sampleHeight: number; mirrored: boolean;
}
export interface BenchmarkReport {
  status: "complete" | "interrupted" | "error" | "unsupported";
  reason: string;
  model: typeof BENCHMARK_MODELS[BenchmarkModel];
  actualBackend: string;
  blockedNetworkRequests: number;
  environment: BenchmarkGeometry & { browser: string; orientation: string; inputClock: string };
  warmupSeconds: number;
  plannedMeasurementSeconds: number;
  metrics: ReturnType<BenchmarkMetrics["summary"]> | null;
}
export interface BenchmarkUpdate {
  state: "loading" | "warming" | "measuring" | BenchmarkReport["status"];
  remainingSeconds: number;
  model: BenchmarkModel;
  diagnostics: PoseDiagnostics;
  metrics: ReturnType<BenchmarkMetrics["summary"]> | null;
  report?: BenchmarkReport;
}

// No RAF, camera owner, persistent storage, or simultaneous model dispatch here.
// The existing PoseController supplies decoded frames and its visible render clock.
export class BenchmarkSession {
  readonly tracker: PoseTracker;
  private layout: PoseLayout = { rect: { x: 0, y: 0, width: 1, height: 1 }, mirrored: false };
  private pose: CommonPose | null = null;
  private capturedAt = -Infinity;
  private metrics: BenchmarkMetrics | null = null;
  private report: BenchmarkReport | undefined;
  private geometry: BenchmarkGeometry = { videoWidth: 0, videoHeight: 0, stageWidth: 0, stageHeight: 0, sampleWidth: 0, sampleHeight: 0, mirrored: false };
  private backend = "";
  private inputClock = "";
  private lastPublish = -Infinity;
  private state: BenchmarkUpdate["state"] = "loading";

  constructor(readonly model: BenchmarkModel, private readonly onUpdate: (update: BenchmarkUpdate) => void,
    private readonly options: { now?: () => number; workerFactory?: () => PoseWorkerPort; assetsUrl?: string;
      capture?: (video: HTMLVideoElement, options: ImageBitmapOptions) => Promise<ImageBitmap>;
      warmupMs?: number; measurementMs?: number; browser?: string } = {}) {
    this.tracker = new PoseTracker({
      ...options, rawOnly: true,
      workerFactory: options.workerFactory ?? (model === "movenet" ? () => new Worker(new URL("./movenet-worker.ts", import.meta.url), { type: "module" }) : undefined),
      onObservation: observation => {
        const pose = commonPose(model, observation.landmarks[0], this.layout);
        this.metrics?.observe(observation, pose);
        this.pose = pose; this.capturedAt = observation.token.capturedAt;
      },
      onAttempt: (now, outcome) => this.metrics?.attempt(now, outcome),
    });
  }

  start(): void { this.tracker.start(); }
  setLayout(layout: PoseLayout): void { this.layout = layout; this.tracker.setLayout(layout); }
  sample(video: HTMLVideoElement, now: number, mediaTime: number): void {
    if (!this.report) this.tracker.sample(video, now, mediaTime);
  }
  snapshot(now: number): CommonPose | null {
    return !this.report && now >= this.capturedAt && now - this.capturedAt <= POSE_FRESH_MS ? this.pose : null;
  }

  render(now: number, drawMs: number, geometry: BenchmarkGeometry, inputClock: string): void {
    if (this.report) return;
    this.geometry = geometry; this.inputClock = inputClock;
    const diagnostics = this.tracker.diagnostics(now);
    if (diagnostics.state === "error" || diagnostics.state === "unsupported") {
      this.finish(diagnostics.state, diagnostics.error, now); return;
    }
    if (diagnostics.state === "ready" && !this.metrics) {
      this.backend = diagnostics.backend;
      this.metrics = new BenchmarkMetrics(now + (this.options.warmupMs ?? 10000), this.options.measurementMs ?? 60000);
    }
    this.metrics?.render(now, drawMs);
    if (this.metrics && now >= this.metrics.end) { this.finish("complete", "Fixed measurement window completed.", now); return; }
    this.state = !this.metrics ? "loading" : now < this.metrics.start ? "warming" : "measuring";
    if (now - this.lastPublish >= 250) { this.lastPublish = now; this.publish(now); }
  }

  private publish(now: number): void {
    this.onUpdate({ state: this.state, model: this.model, diagnostics: this.tracker.diagnostics(now),
      remainingSeconds: this.metrics && (this.state === "warming" || this.state === "measuring")
        ? Math.max(0, Math.ceil(((this.state === "warming" ? this.metrics.start : this.metrics.end) - now) / 1000)) : 0,
      metrics: this.metrics?.summary(now) ?? null, report: this.report });
  }

  private finish(status: BenchmarkReport["status"], reason: string, now: number): void {
    if (this.report) return;
    this.state = status;
    this.report = { status, reason, model: BENCHMARK_MODELS[this.model], actualBackend: this.backend || "Not initialized",
      blockedNetworkRequests: this.tracker.diagnostics(now).blockedNetworkRequests,
      environment: { ...this.geometry, browser: this.options.browser ?? navigator.userAgent,
        orientation: this.geometry.videoHeight > this.geometry.videoWidth ? "portrait" : "landscape", inputClock: this.inputClock },
      warmupSeconds: (this.options.warmupMs ?? 10000) / 1000,
      plannedMeasurementSeconds: (this.options.measurementMs ?? 60000) / 1000,
      metrics: this.metrics?.summary(now) ?? null };
    this.tracker.stop(); this.pose = null;
    this.publish(now);
  }

  stop(reason: string, now = this.options.now?.() ?? performance.now()): void {
    this.finish("interrupted", reason, now);
    this.tracker.stop();
  }
}
