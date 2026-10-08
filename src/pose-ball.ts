import type { Ball, Vector } from "./ball";
import { headRadius } from "./pose/pose-geometry";
import { isPoseFresh, JOINT, POSE_FRESH_MS } from "./pose/pose-types";
import type { Pose, PoseFrame, PoseLandmark } from "./pose/pose-types";

export type BodyPart = "left hand" | "right hand" | "left foot" | "right foot" | "head";
export interface PoseCollider extends Vector {
  readonly part: BodyPart;
  readonly radius: number;
  readonly velocity: Vector;
  readonly source: string;
}
interface ContactHistory {
  collider: PoseCollider;
  ball: Vector;
  at: number;
  touching: boolean;
  clearSamples: number;
  hitAt: number;
}
interface BallSample {
  at: number;
  position: Vector;
  velocity: Vector;
}
export interface PoseHit { part: BodyPart; speed: number; strength: number; at: number }

// All contact distances/radii/speeds below use the SHORTER stage edge.
export const POSE_CONTACT = Object.freeze({
  // The 8–10 Hz mobile tracker takes ~80 ms to return each captured frame.
  // A 5 Hz sample can be 320 ms old before the next result arrives: retain
  // *history* longer than a render snapshot, but NEVER strike from stale input.
  maxAgeMs: 260, maxIntervalMs: 260, historyRetentionMs: 420, cooldownMs: 140,
  minClosingSpeed: 0.12, rearmDistance: 0.012,
  maxDisplacement: 0.4, maxLimbSpeed: 8, maxImpulse: 3.2,
  handRadius: 0.026, footRadius: 0.035,
});

export function toBallUnits(vector: Vector, scaleX: number, scaleY: number): Vector {
  return { x: vector.x / scaleX, y: vector.y / scaleY };
}

// Centers and velocities are already mirrored/mapped by PoseTracker. Never
// mirror again, clamp an offscreen joint, or change centers without re-seeding.
export function poseColliders(pose: Pose, ball: Ball): PoseCollider[] {
  const points = pose.landmarks, b = ball.bounds;
  const valid = (p: PoseLandmark | undefined): p is PoseLandmark => Boolean(p?.reliable
    && [p.x, p.y, p.vx, p.vy, p.raw.x, p.raw.y].every(Number.isFinite)
    && p.raw.x >= 0 && p.raw.x <= 1 && p.raw.y >= 0 && p.raw.y <= 1
    && p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height);
  const result: PoseCollider[] = [];
  const add = (part: BodyPart, ids: number[], radius: number): void => {
    if (!ids.every(i => valid(points[i]))) return;
    const average = (key: "x" | "y" | "vx" | "vy") => ids.reduce((sum, i) => sum + points[i][key], 0) / ids.length;
    result.push({ part, ...toBallUnits({ x: average("x"), y: average("y") }, ball.scaleX, ball.scaleY),
      velocity: toBallUnits({ x: average("vx"), y: average("vy") }, ball.scaleX, ball.scaleY), radius, source: ids.join(",") });
  };
  // Small forgiving circles at the visible wrists; no finger/fist detection.
  add("left hand", [JOINT.leftWrist], POSE_CONTACT.handRadius);
  add("right hand", [JOINT.rightWrist], POSE_CONTACT.handRadius);
  for (const [part, ankle, toe] of [["left foot", JOINT.leftAnkle, JOINT.leftFoot], ["right foot", JOINT.rightAnkle, JOINT.rightFoot]] as const) {
    const ids = valid(points[toe]) ? [ankle, toe] : [ankle];
    add(part, ids, POSE_CONTACT.footRadius);
  }
  if ([JOINT.nose, JOINT.leftShoulder, JOINT.rightShoulder].every(i => valid(points[i]))) {
    add("head", [JOINT.nose], headRadius(pose, ball.scaleX, ball.scaleY));
  }
  return result;
}

// Relative swept circles catch both a quick limb crossing the ball and a ball
// crossing a still limb between samples. Return the FIRST entry normal, rather
// than the far-side end normal, so fast punches never send the ball backwards.
export function sweptContact(limbStart: Vector, limbEnd: Vector, ballStart: Vector, ballEnd: Vector, radius: number): Vector | null {
  const start = { x: ballStart.x - limbStart.x, y: ballStart.y - limbStart.y };
  const delta = { x: ballEnd.x - limbEnd.x - start.x, y: ballEnd.y - limbEnd.y - start.y };
  const c = start.x * start.x + start.y * start.y - radius * radius;
  let t = 0;
  if (c > 0) {
    const a = delta.x * delta.x + delta.y * delta.y;
    if (a < 1e-12) return null;
    const b = 2 * (start.x * delta.x + start.y * delta.y), discriminant = b * b - 4 * a * c;
    if (discriminant < 0) return null;
    t = (-b - Math.sqrt(discriminant)) / (2 * a);
    if (t < 0 || t > 1) return null;
  }
  const normal = { x: start.x + delta.x * t, y: start.y + delta.y * t };
  const length = Math.hypot(normal.x, normal.y);
  if (length > 1e-6) return { x: normal.x / length, y: normal.y / length };
  // Coincident centers: use relative approach, never an arbitrary launch.
  const approach = Math.hypot(delta.x, delta.y);
  return approach > 1e-6 ? { x: -delta.x / approach, y: -delta.y / approach } : null;
}

// Game-layer adapter for ONE ball. Pose modules remain unaware of game rules.
// Sample history/contact state is per body part, ready for a later grab adapter.
export class PoseBallContacts {
  colliders: readonly PoseCollider[] = [];
  lastHit: PoseHit | null = null;
  private history = new Map<BodyPart, ContactHistory>();
  private capturedAt = -Infinity;
  private lastUsableAt = -Infinity;
  // Render-cadence trajectory lets delayed camera frames collide against the
  // ball's position AT CAPTURE, not where the ball is ~80–120 ms later.
  private readonly ballSamples: BallSample[] = [];

  reset(): void {
    this.clearContacts();
    this.capturedAt = this.lastUsableAt = -Infinity;
    this.lastHit = null;
    this.ballSamples.length = 0;
  }

  private clearContacts(): void { this.history.clear(); this.colliders = []; }

  private recordBall(now: number, ball: Ball): void {
    const sample: BallSample = {
      at: now, position: { x: ball.x / ball.scaleX, y: ball.y / ball.scaleY },
      velocity: { x: ball.vx, y: ball.vy },
    };
    const last = this.ballSamples[this.ballSamples.length - 1];
    if (last?.at === now) this.ballSamples[this.ballSamples.length - 1] = sample;
    else if (!last || now > last.at) this.ballSamples.push(sample);
    while (this.ballSamples.length > 2 && this.ballSamples[1].at < now - 700) this.ballSamples.shift();
  }

  private ballAt(capturedAt: number, ball: Ball): BallSample {
    const samples = this.ballSamples;
    if (!samples.length) return { at: capturedAt,
      position: toBallUnits(ball, ball.scaleX, ball.scaleY),
      velocity: { x: ball.vx, y: ball.vy } };
    if (capturedAt <= samples[0].at) return samples[0];
    for (let i = 1; i < samples.length; i++) {
      const end = samples[i], start = samples[i - 1];
      if (capturedAt > end.at) continue;
      const weight = Math.max(0, Math.min(1, (capturedAt - start.at) / (end.at - start.at)));
      const mix = (a: Vector, b: Vector): Vector => ({
        x: a.x + (b.x - a.x) * weight, y: a.y + (b.y - a.y) * weight,
      });
      return { at: capturedAt, position: mix(start.position, end.position),
        velocity: mix(start.velocity, end.velocity) };
    }
    return samples[samples.length - 1];
  }

  tick(now: number, frame: PoseFrame | null, ball: Ball): void {
    const pose = isPoseFresh(frame, now) ? frame.poses[0] : undefined;
    const usable = pose && pose.state !== "unusable";
    if (usable) this.lastUsableAt = Math.max(this.lastUsableAt, frame!.capturedAt);
    // Brief missed inference does not freeze gravity. Genuine loss does pause;
    // resume seeds the clock, so time offscreen never becomes a giant step.
    if (now >= this.lastUsableAt && now - this.lastUsableAt <= POSE_FRESH_MS) ball.advance(now);
    else ball.pause();
    this.recordBall(now, ball);
    if (!usable || !frame || now - frame.capturedAt > POSE_CONTACT.maxAgeMs) {
      // A delayed result is not itself a new strike. Don't erase valid sample
      // history just because a render happened before the next worker result.
      // A NEW unusable pose does invalidate it immediately; true gaps expire.
      if ((frame && isPoseFresh(frame, now) && frame.capturedAt > this.capturedAt && !usable)
          || now - this.capturedAt > POSE_CONTACT.historyRetentionMs) this.clearContacts();
      ball.debug.contact = false; return;
    }
    if (frame.capturedAt <= this.capturedAt) return; // Repeated/out-of-order frames.
    this.capturedAt = frame.capturedAt;
    this.colliders = poseColliders(pose, ball);
    const active = new Set(this.colliders.map(c => c.part));
    for (const part of this.history.keys()) if (!active.has(part)) this.history.delete(part);
    const sampledBall = this.ballAt(frame.capturedAt, ball);
    const center = sampledBall.position;
    ball.debug.contact = false;
    for (const collider of this.colliders) {
      const previous = this.history.get(collider.part);
      const radius = ball.radius + collider.radius;
      const distance = Math.hypot(center.x - collider.x, center.y - collider.y);
      const overlapping = distance <= radius;
      ball.debug.contact ||= overlapping;
      const dtMs = previous ? frame.capturedAt - previous.at : 0;
      const delta = previous ? { x: collider.x - previous.collider.x, y: collider.y - previous.collider.y } : { x: 0, y: 0 };
      const velocity = { x: delta.x * 1000 / (dtMs || 1), y: delta.y * 1000 / (dtMs || 1) };
      // The snapshot's zeroed velocity catches smoother teleports/reacquisition
      // that might otherwise look like a valid short sweep in a wide stage.
      const continuous = previous && previous.collider.source === collider.source
        && dtMs >= 16 && dtMs <= POSE_CONTACT.maxIntervalMs
        && Math.hypot(delta.x, delta.y) <= POSE_CONTACT.maxDisplacement
        && Math.hypot(velocity.x, velocity.y) <= POSE_CONTACT.maxLimbSpeed
        && Math.hypot(velocity.x - collider.velocity.x, velocity.y - collider.velocity.y) < 0.15;
      const state: ContactHistory = { collider, ball: center, at: frame.capturedAt,
        touching: continuous ? previous.touching : overlapping,
        clearSamples: continuous ? previous.clearSamples : 0, hitAt: previous?.hitAt ?? -Infinity };
      this.history.set(collider.part, state);
      if (!continuous) continue; // Seed, including initial overlap; never strike.
      if (state.touching) {
        if (distance > radius + POSE_CONTACT.rearmDistance) {
          if (++state.clearSamples >= 2) state.touching = false;
        } else state.clearSamples = 0;
        continue;
      }
      const normal = sweptContact(previous.collider, collider, previous.ball, center, radius);
      if (!normal) continue;
      state.touching = true; state.clearSamples = 0;
      const closing = (velocity.x - sampledBall.velocity.x) * normal.x
        + (velocity.y - sampledBall.velocity.y) * normal.y;
      if (closing < POSE_CONTACT.minClosingSpeed || now - state.hitAt < POSE_CONTACT.cooldownMs) continue;
      const strength = Math.min(POSE_CONTACT.maxImpulse, 0.16 + closing * 1.55);
      ball.applyImpulse(now, { x: normal.x * strength, y: normal.y * strength });
      state.hitAt = now;
      ball.debug.motion = velocity;
      this.lastHit = { part: collider.part, speed: Math.hypot(velocity.x, velocity.y),
        strength: Math.hypot(ball.debug.impulse.x, ball.debug.impulse.y), at: now };
    }
  }
}

export function drawPoseContacts(canvas: HTMLCanvasElement, contacts: PoseBallContacts): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const short = Math.min(canvas.width, canvas.height);
  ctx.save(); ctx.lineWidth = 2; ctx.strokeStyle = "#85e5efaa";
  for (const collider of contacts.colliders) {
    ctx.beginPath(); ctx.arc(collider.x * short, collider.y * short, collider.radius * short, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();
}
