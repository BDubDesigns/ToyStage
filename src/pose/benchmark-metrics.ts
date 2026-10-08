import { COMMON_JOINTS } from "./benchmark-joints";
import type { CommonPose } from "./benchmark-joints";
import type { PoseObservation } from "./pose-tracker";
import type { PoseFrameGate } from "./pose-protocol";
import { POSE_FRESH_MS } from "./pose-types";

export function distribution(values: readonly number[]) {
  const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!sorted.length) return { count: 0, average: null, p50: null, p95: null };
  const round = (value: number) => Math.round(value * 100) / 100;
  const percentile = (p: number) => round(sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)]);
  return { count: sorted.length, average: round(sorted.reduce((a, b) => a + b, 0) / sorted.length), p50: percentile(0.5), p95: percentile(0.95) };
}

// A single fixed window; all timings are main performance.now(). No raw joints
// or frames are retained in the exported report. Warmup never enters counters.
export class BenchmarkMetrics {
  private cursor: number;
  private usableUntil = -Infinity;
  private noPoseUntil = -Infinity;
  private unavailableMs = 0;
  private noPoseMs = 0;
  private lastRender: number | null = null;
  private frames = 0;
  private results = 0;
  private fresh = 0;
  private usable = 0;
  private stale = 0;
  private invalid = 0;
  private noPerson = 0;
  private submitted = 0;
  private backpressure = 0;
  private cadence = 0;
  private duplicates = 0;
  private readonly jointCounts = Object.fromEntries(COMMON_JOINTS.map(name => [name, 0])) as Record<typeof COMMON_JOINTS[number], number>;
  private readonly inference: number[] = [];
  private readonly capture: number[] = [];
  private readonly latency: number[] = [];
  private readonly usableLatency: number[] = [];
  private readonly roundTrip: number[] = [];
  private readonly intervals: number[] = [];
  private readonly draws: number[] = [];

  constructor(readonly start: number, readonly durationMs = 60000) { this.cursor = start; }
  get end(): number { return this.start + this.durationMs; }
  private inside(now: number): boolean { return now >= this.start && now < this.end; }

  advance(now: number): void {
    const next = Math.max(this.cursor, Math.min(this.end, now));
    this.unavailableMs += Math.max(0, next - Math.max(this.cursor, this.usableUntil));
    // Explicit no-person time includes startup/absence and expires a previously
    // present observation at the same 300 ms freshness limit as the overlay.
    this.noPoseMs += Math.max(0, next - Math.max(this.cursor, this.noPoseUntil));
    this.cursor = next;
  }

  attempt(now: number, outcome: PoseFrameGate["lastOutcome"]): void {
    if (!this.inside(now)) return;
    if (outcome === "accepted") this.submitted++;
    if (outcome === "backpressure") this.backpressure++;
    if (outcome === "cadence") this.cadence++;
    if (outcome === "duplicate") this.duplicates++;
  }

  observe(observation: PoseObservation, pose: CommonPose): void {
    const { token, receivedAt, inferenceMs, captureMs, roundTripMs } = observation;
    if (!this.inside(token.capturedAt) || !this.inside(receivedAt)) return;
    this.advance(receivedAt);
    this.results++;
    const latency = receivedAt - token.capturedAt;
    const stale = latency < 0 || latency > POSE_FRESH_MS;
    if (stale) this.stale++;
    else this.fresh++;
    if (pose.invalid) this.invalid++;
    if (!pose.present) this.noPerson++;
    this.inference.push(inferenceMs); this.capture.push(captureMs); this.latency.push(latency); this.roundTrip.push(roundTripMs);
    if (!stale && pose.usable) {
      this.usable++; this.usableLatency.push(latency);
      this.usableUntil = token.capturedAt + POSE_FRESH_MS;
    } else this.usableUntil = -Infinity;
    this.noPoseUntil = !stale && pose.present && !pose.invalid ? token.capturedAt + POSE_FRESH_MS : -Infinity;
    if (!stale) for (const joint of pose.joints) if (joint.reliable) this.jointCounts[joint.name]++;
  }

  render(now: number, drawMs: number): void {
    if (!this.inside(now)) return;
    this.advance(now);
    if (this.lastRender !== null) this.intervals.push(now - this.lastRender);
    this.lastRender = now;
    this.frames++; this.draws.push(drawMs);
  }

  summary(now: number) {
    this.advance(now);
    const seconds = Math.max(0, Math.min(this.end, now) - this.start) / 1000;
    const rate = (count: number) => seconds ? +(count / seconds).toFixed(2) : 0;
    const fraction = (count: number) => this.results ? +(count / this.results).toFixed(4) : null;
    return {
      measuredSeconds: +seconds.toFixed(2), stageFps: rate(this.frames),
      stageFrameIntervalMs: distribution(this.intervals), stageDrawMs: distribution(this.draws),
      inferenceMs: distribution(this.inference), captureMs: distribution(this.capture),
      captureToResultMs: distribution(this.latency), captureToUsableLandmarksMs: distribution(this.usableLatency),
      sendToResultMs: distribution(this.roundTrip), freshSampleHz: rate(this.fresh), usablePoseHz: rate(this.usable),
      samples: { submitted: this.submitted, received: this.results, fresh: this.fresh, usable: this.usable,
        stale: this.stale, invalid: this.invalid, noPerson: this.noPerson, unfinishedAtBoundary: this.submitted - this.results },
      staleFraction: fraction(this.stale), invalidFraction: fraction(this.invalid), unusableFraction: fraction(this.results - this.usable),
      noPoseSeconds: +(this.noPoseMs / 1000).toFixed(2), noUsablePoseSeconds: +(this.unavailableMs / 1000).toFixed(2),
      reliableJointFraction: Object.fromEntries(COMMON_JOINTS.map(name => [name, fraction(this.jointCounts[name])])),
      skips: { backpressure: this.backpressure, cadence: this.cadence, duplicateVideoFrames: this.duplicates },
    };
  }
}
