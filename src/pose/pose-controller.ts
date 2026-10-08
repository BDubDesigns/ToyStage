import { getCameraRect, getRenderSize } from "../compositor-layout";
import { PoseTracker } from "./pose-tracker";
import type { PoseDiagnostics } from "./pose-tracker";
import { StickFigureView } from "./stick-figure-view";
import type { PoseFrame } from "./pose-types";
import { BenchmarkSession } from "./benchmark-session";
import type { BenchmarkUpdate } from "./benchmark-session";
import type { BenchmarkModel } from "./benchmark-joints";
import { drawBenchmark } from "./benchmark-view";

export interface PoseStageDiagnostics extends PoseDiagnostics {
  readonly frame: PoseFrame | null;
  readonly fps: number;
  readonly frameMs: number;
  readonly drawMs: number;
  readonly width: number;
  readonly height: number;
  readonly videoWidth: number;
  readonly videoHeight: number;
  readonly mirrored: boolean;
  readonly benchmark: boolean;
}

// Owns Pose Mode's ONE render RAF. rVFC only offers decoded input; fallback
// sampling shares this render RAF. Neither controller nor tracker owns a camera.
export class PoseController {
  private readonly normalTracker = new PoseTracker();
  private benchmark: BenchmarkSession | null = null;
  private get tracker(): PoseTracker { return this.benchmark?.tracker ?? this.normalTracker; }
  private readonly view: StickFigureView;
  private observer: ResizeObserver | null = null;
  private animationId: number | null = null;
  private videoCallbackId: number | null = null;
  private running = false;
  private lastScheduled = -Infinity;
  private lastFrame = 0;
  private statsStart = 0;
  private lastReport = 0;
  private frames = 0;
  private frameTotal = 0;
  private drawTotal = 0;
  private fps = 0;
  private frameMs = 0;
  private drawMs = 0;
  private sourceWidth = 0;
  private sourceHeight = 0;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly video: HTMLVideoElement,
    private readonly mirrored: boolean, private readonly onDiagnostics: (stats: PoseStageDiagnostics) => void) {
    this.view = new StickFigureView(canvas);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.tracker.start();
    this.observer = new ResizeObserver(this.resize);
    this.observer.observe(this.canvas);
    document.addEventListener("visibilitychange", this.visibility);
    this.resize();
    this.visibility();
  }

  private resize = (): void => {
    const bounds = this.canvas.getBoundingClientRect();
    const size = getRenderSize(bounds.width, bounds.height, window.devicePixelRatio || 1);
    if (size.width !== this.canvas.width || size.height !== this.canvas.height) {
      this.canvas.width = size.width; this.canvas.height = size.height;
      this.tracker.invalidate();
      this.stopBenchmark("Stage resized or rotated.");
    }
    this.updateLayout();
  };

  private updateLayout(): void {
    if (this.sourceWidth !== this.video.videoWidth || this.sourceHeight !== this.video.videoHeight) {
      this.sourceWidth = this.video.videoWidth; this.sourceHeight = this.video.videoHeight;
      this.tracker.invalidate();
      this.stopBenchmark("Decoded camera dimensions changed.");
    }
    this.tracker.setLayout({ rect: this.rect(), mirrored: this.mirrored });
    this.benchmark?.setLayout({ rect: this.rect(), mirrored: this.mirrored });
  }

  private rect() { return getCameraRect(this.canvas.width, this.canvas.height, this.video.videoWidth || 1, this.video.videoHeight || 1); }

  private scheduleVideo(): void {
    if (!this.running || document.hidden || !this.video.requestVideoFrameCallback || this.videoCallbackId !== null) return;
    this.videoCallbackId = this.video.requestVideoFrameCallback((_now, metadata) => {
      this.videoCallbackId = null;
      if (!this.running || document.hidden) return;
      this.updateLayout();
      this.sample(performance.now(), metadata.mediaTime);
      this.scheduleVideo();
    });
  }

  private render = (now: number): void => {
    this.animationId = null;
    if (!this.running || document.hidden) return;
    this.animationId = requestAnimationFrame(this.render);
    if (now - this.lastScheduled < 1000 / 30 - 0.5) return;
    this.lastScheduled = now;
    const start = performance.now();
    this.updateLayout();
    if (!this.video.requestVideoFrameCallback) this.sample(performance.now(), this.video.currentTime);
    const frame = this.tracker.snapshot(now);
    if (this.benchmark) drawBenchmark(this.canvas, this.benchmark.snapshot(now), this.rect());
    else this.view.draw(frame, this.rect());
    this.benchmark?.render(now, performance.now() - start, {
      videoWidth: this.video.videoWidth, videoHeight: this.video.videoHeight, stageWidth: this.canvas.width, stageHeight: this.canvas.height,
      sampleWidth: this.tracker.diagnostics(now).sampleWidth, sampleHeight: this.tracker.diagnostics(now).sampleHeight, mirrored: this.mirrored,
    }, typeof this.video.requestVideoFrameCallback === "function" ? "decoded rVFC" : "render RAF / currentTime fallback");
    if (this.lastFrame) this.frameTotal += now - this.lastFrame;
    this.lastFrame = now; this.frames++; this.drawTotal += performance.now() - start;
    if (now - this.statsStart >= 1000) {
      this.fps = this.frames * 1000 / (now - this.statsStart);
      this.frameMs = this.frameTotal / Math.max(1, this.frames - 1);
      this.drawMs = this.drawTotal / this.frames;
      this.statsStart = now; this.frames = this.frameTotal = this.drawTotal = 0; this.lastFrame = 0;
    }
    if (now - this.lastReport >= 200) { this.lastReport = now; this.report(frame, now); }
  };

  private report(frame: PoseFrame | null, now: number): void {
    this.onDiagnostics({ ...this.tracker.diagnostics(now), frame, fps: this.fps, frameMs: this.frameMs, drawMs: this.drawMs,
      width: this.canvas.width, height: this.canvas.height, videoWidth: this.video.videoWidth, videoHeight: this.video.videoHeight, mirrored: this.mirrored,
      benchmark: this.benchmark !== null });
  }

  private cancelClocks(): void {
    if (this.animationId !== null) cancelAnimationFrame(this.animationId);
    if (this.videoCallbackId !== null) this.video.cancelVideoFrameCallback(this.videoCallbackId);
    this.animationId = this.videoCallbackId = null;
  }

  private visibility = (): void => {
    if (!this.running) return;
    this.cancelClocks();
    if (document.hidden) this.stopBenchmark("Tab hidden. Start a new uninterrupted run.");
    this.tracker.pause();
    this.view.draw(null, this.rect());
    this.fps = this.frameMs = this.drawMs = this.frames = this.frameTotal = this.drawTotal = this.lastFrame = 0;
    this.statsStart = performance.now(); this.lastScheduled = -Infinity;
    this.report(null, performance.now());
    if (!document.hidden) {
      this.tracker.start();
      this.tracker.resume();
      this.scheduleVideo();
      this.animationId = requestAnimationFrame(this.render);
    }
  };

  dispose(): void {
    this.running = false;
    this.cancelClocks();
    this.observer?.disconnect(); this.observer = null;
    document.removeEventListener("visibilitychange", this.visibility);
    this.benchmark?.stop("Camera stopped, switched, or Pose Mode closed."); this.benchmark = null;
    this.normalTracker.stop();
    this.view.draw(null, this.rect());
  }

  private sample(now: number, mediaTime: number): void {
    if (this.benchmark) this.benchmark.sample(this.video, now, mediaTime);
    else this.tracker.sample(this.video, now, mediaTime);
  }

  runBenchmark(model: BenchmarkModel, onUpdate: (update: BenchmarkUpdate) => void): void {
    this.benchmark?.stop("Another model/run selected.");
    this.normalTracker.stop();
    this.benchmark = new BenchmarkSession(model, onUpdate);
    this.benchmark.setLayout({ rect: this.rect(), mirrored: this.mirrored });
    this.benchmark.start();
  }

  stopBenchmark(reason: string): void {
    if (!this.benchmark) return;
    this.benchmark.stop(reason); this.benchmark = null;
    if (this.running && !document.hidden) this.normalTracker.start();
  }
}
