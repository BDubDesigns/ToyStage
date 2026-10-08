import { getCameraRect, getRenderSize } from "../compositor-layout";
import { PoseTracker } from "./pose-tracker";
import type { PoseDiagnostics } from "./pose-tracker";
import { StickFigureView } from "./stick-figure-view";
import type { PoseFrame } from "./pose-types";
import type { CameraRect } from "../compositor-layout";

export interface PoseStageCallbacks {
  onFrame(now: number, frame: PoseFrame | null, width: number, height: number, rect: CameraRect): void;
  onInvalidate(): void;
}

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
}

// Owns Pose Mode's ONE render RAF. rVFC only offers decoded input; fallback
// sampling shares this render RAF. Neither controller nor tracker owns a camera.
export class PoseController {
  private readonly tracker = new PoseTracker();
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
    private readonly mirrored: boolean, private readonly onDiagnostics: (stats: PoseStageDiagnostics) => void,
    private readonly callbacks?: PoseStageCallbacks) {
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
      this.callbacks?.onInvalidate();
    }
    this.updateLayout();
  };

  private updateLayout(): void {
    if (this.sourceWidth !== this.video.videoWidth || this.sourceHeight !== this.video.videoHeight) {
      this.sourceWidth = this.video.videoWidth; this.sourceHeight = this.video.videoHeight;
      this.tracker.invalidate();
      this.callbacks?.onInvalidate();
    }
    this.tracker.setLayout({ rect: this.rect(), mirrored: this.mirrored });
  }

  private rect() { return getCameraRect(this.canvas.width, this.canvas.height, this.video.videoWidth || 1, this.video.videoHeight || 1); }

  private scheduleVideo(): void {
    if (!this.running || document.hidden || !this.video.requestVideoFrameCallback || this.videoCallbackId !== null) return;
    this.videoCallbackId = this.video.requestVideoFrameCallback((_now, metadata) => {
      this.videoCallbackId = null;
      if (!this.running || document.hidden) return;
      this.updateLayout();
      this.tracker.sample(this.video, performance.now(), metadata.mediaTime);
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
    if (!this.video.requestVideoFrameCallback) this.tracker.sample(this.video, performance.now(), this.video.currentTime);
    const frame = this.tracker.snapshot(now);
    this.view.draw(frame, this.rect());
    this.callbacks?.onFrame(now, frame, this.canvas.width, this.canvas.height, this.rect());
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
      width: this.canvas.width, height: this.canvas.height, videoWidth: this.video.videoWidth, videoHeight: this.video.videoHeight, mirrored: this.mirrored });
  }

  private cancelClocks(): void {
    if (this.animationId !== null) cancelAnimationFrame(this.animationId);
    if (this.videoCallbackId !== null) this.video.cancelVideoFrameCallback(this.videoCallbackId);
    this.animationId = this.videoCallbackId = null;
  }

  private visibility = (): void => {
    if (!this.running) return;
    this.cancelClocks();
    this.tracker.pause();
    this.callbacks?.onInvalidate();
    this.view.draw(null, this.rect());
    this.fps = this.frameMs = this.drawMs = this.frames = this.frameTotal = this.drawTotal = this.lastFrame = 0;
    this.statsStart = performance.now(); this.lastScheduled = -Infinity;
    this.report(null, performance.now());
    if (!document.hidden) {
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
    this.tracker.stop();
    this.callbacks?.onInvalidate();
    this.view.draw(null, this.rect());
  }
}
