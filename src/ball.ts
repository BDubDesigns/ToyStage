import type { CameraRect } from "./compositor-layout";
import type { ForegroundMask } from "./foreground-mask";
import { getBallProfile } from "./ball-profiles";
import type { BallProfile, BallType } from "./ball-profiles";

export interface Vector { x: number; y: number }
export interface BallDebug {
  fresh: boolean;
  contact: boolean;
  coverage: number;
  changed: number;
  motion: Vector | null;
  impulse: Vector;
  hitTime: number;
  hits: number;
}
const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

// Position is stage-normalized; velocity/radius use the stage's shorter edge
// as a unit. This keeps the ball round and physics consistent across aspects.
export class Ball {
  x = 0.5;
  y = 0.45;
  vx = 0;
  vy = 0;
  radius = 0.055;
  scaleX = 1;
  scaleY = 1;
  bounds: CameraRect = { x: 0, y: 0, width: 1, height: 1 };
  debug: BallDebug = { fresh: false, contact: false, coverage: 0, changed: 0, motion: null, impulse: { x: 0, y: 0 }, hitTime: -Infinity, hits: 0 };
  private frameTime: number | null = null;
  private sampleTime: number | null = null;
  private touching = false;
  private clearSamples = 0;
  private activeProfile: BallProfile;

  constructor(type: BallType = "eight-ball") {
    this.activeProfile = getBallProfile(type);
    this.updateRadius();
  }

  get profile(): BallProfile { return this.activeProfile; }
  get radiusX(): number { return this.radius * this.scaleX; }
  get radiusY(): number { return this.radius * this.scaleY; }
  get grounded(): boolean {
    return this.profile.bounds === "gravity" && this.y >= this.bounds.y + this.bounds.height - this.radiusY - 1e-9 && this.vy === 0;
  }
  // The marker disappears as soon as any of the object re-enters the stage.
  // Camera inset/letterboxing is not a ceiling or the indicator's top edge.
  get aboveStage(): boolean { return this.profile.bounds === "gravity" && this.y + this.radiusY < 0; }

  setType(type: BallType): void {
    this.activeProfile = getBallProfile(type);
    this.updateRadius();
    this.reset();
  }

  private updateRadius(): void {
    // Scale the entire preset range in a narrow fitted camera: preserve #7's
    // 8 Ball size without making Super Ball and Dodgeball equally large.
    const fit = Math.min(1, this.bounds.width / this.scaleX * 0.1 / 0.055, this.bounds.height / this.scaleY * 0.1 / 0.055);
    this.radius = this.profile.radius * fit;
  }

  layout(width: number, height: number, bounds: CameraRect): void {
    const scaleX = Math.min(width, height) / width, scaleY = Math.min(width, height) / height;
    const b = this.bounds;
    if (this.scaleX === scaleX && this.scaleY === scaleY && b.x === bounds.x && b.y === bounds.y && b.width === bounds.width && b.height === bounds.height) return;
    this.scaleX = scaleX;
    this.scaleY = scaleY;
    this.bounds = { ...bounds };
    this.updateRadius();
    // Rotation changes reachable play space. Start in its center instead of
    // leaving the ball trapped outside the fitted camera.
    this.reset();
  }

  reset(x = this.bounds.x + this.bounds.width * 0.5, y = this.bounds.y + this.bounds.height * 0.45): void {
    this.x = clamp(x, this.bounds.x + this.radiusX, this.bounds.x + this.bounds.width - this.radiusX);
    this.y = clamp(y, this.bounds.y + this.radiusY, this.bounds.y + this.bounds.height - this.radiusY);
    this.vx = this.vy = 0;
    this.debug.hits = 0;
    this.debug.hitTime = -Infinity;
    this.debug.impulse = { x: 0, y: 0 };
    this.pause();
  }

  pause(): void {
    this.frameTime = this.sampleTime = null;
    this.touching = false;
    this.clearSamples = 0;
    this.debug.fresh = this.debug.contact = false;
    this.debug.coverage = this.debug.changed = 0;
    this.debug.motion = null;
  }

  tick(now: number, mask: ForegroundMask): void {
    if (mask.timestamp === null || now - mask.timestamp > 250 || now < mask.timestamp) { this.pause(); return; }
    this.advance(now);
    if (mask.timestamp === this.sampleTime) return;

    const contact = mask.contact(this.x, this.y, this.radiusX, this.radiusY);
    const motion = mask.motion({ x: this.x - this.radiusX * 3, y: this.y - this.radiusY * 3, width: this.radiusX * 6, height: this.radiusY * 6 });
    this.debug.coverage = contact.coverage;
    this.debug.changed = motion.changed;
    this.debug.motion = motion.velocity ? { x: motion.velocity.x / this.scaleX, y: motion.velocity.y / this.scaleY } : null;
    this.debug.contact = contact.coverage >= 0.06;

    // Seed occupancy on reset/resume/recalibration; do not treat an already
    // overlapping stationary toy or a first mask as a new strike.
    if (this.sampleTime === null || motion.intervalMs === 0) {
      this.touching = this.debug.contact;
      this.clearSamples = 0;
      this.sampleTime = mask.timestamp;
      return;
    }
    this.sampleTime = mask.timestamp;
    if (contact.coverage < 0.02) {
      if (++this.clearSamples >= 2) this.touching = false;
      return;
    }
    this.clearSamples = 0;
    if (!this.debug.contact || this.touching) return;
    this.touching = true;
    if (now - this.debug.hitTime < 180) return;

    // Motion need only be approximate. A moving ball may also bounce against
    // an unchanged toy; a static noisy overlap is not itself a strike.
    const ballSpeed = Math.hypot(this.vx, this.vy);
    if (motion.changed < 0.015 && ballSpeed < 0.08) return;
    const toy = this.debug.motion;
    const toySpeed = toy && motion.changed >= 0.015 ? Math.hypot(toy.x, toy.y) : 0;
    let direction: Vector = toy && toySpeed > 0.04 ? { ...toy } : {
      x: (this.x - (contact.centroid?.x ?? this.x)) / this.scaleX,
      y: (this.y - (contact.centroid?.y ?? this.y)) / this.scaleY,
    };
    let length = Math.hypot(direction.x, direction.y);
    if (length < 0.001) {
      direction = ballSpeed > 0.08 ? { x: -this.vx, y: -this.vy } : { x: 0.45, y: -1 };
      length = Math.hypot(direction.x, direction.y);
    }
    direction.x /= length;
    direction.y /= length;
    const strength = clamp(0.22 + toySpeed * 1.15 + ballSpeed * 0.55, 0.22, 1.8) * this.profile.hitScale;
    this.debug.impulse = { x: direction.x * strength, y: direction.y * strength };
    this.vx = this.vx * 0.25 + this.debug.impulse.x;
    this.vy = this.vy * 0.25 + this.debug.impulse.y;
    this.limitSpeed();
    this.debug.hitTime = now;
    this.debug.hits++;
  }

  // Input owners decide freshness/pause policy. The integrator has no mask or
  // pose dependency; Green-screen tick retains its existing contact semantics.
  advance(now: number): void {
    if (!Number.isFinite(now)) return;
    this.debug.fresh = true;
    const dt = this.frameTime === null ? 0 : clamp((now - this.frameTime) / 1000, 0, 0.05);
    this.frameTime = now;
    const steps = Math.max(1, Math.ceil(dt * 120));
    for (let i = 0; i < steps; i++) this.integrate(dt / steps);
  }

  // Explicit velocity delta in shorter-edge units/s. Material response and
  // both impulse/final-speed caps stay with the ball, never the input tracker.
  applyImpulse(now: number, impulse: Vector): void {
    if (![now, impulse.x, impulse.y].every(Number.isFinite)) return;
    const speed = Math.hypot(impulse.x, impulse.y);
    if (speed === 0) return;
    const scale = Math.min(this.profile.hitScale, this.profile.maxSpeed * 2 / speed);
    this.debug.impulse = { x: impulse.x * scale, y: impulse.y * scale };
    this.vx += this.debug.impulse.x;
    this.vy += this.debug.impulse.y;
    this.limitSpeed();
    this.debug.hitTime = now;
    this.debug.hits++;
  }

  private integrate(dt: number): void {
    const p = this.profile, grounded = this.grounded;
    this.vx *= Math.exp(-(grounded ? p.rollingDrag : p.airDrag) * dt);
    if (p.bounds === "contained") {
      // Keep #7's damping, settling, and all-sides boundary behavior exactly.
      this.vy *= Math.exp(-p.airDrag * dt);
      if (Math.hypot(this.vx, this.vy) < p.settleSpeed) this.vx = this.vy = 0;
    } else if (grounded) {
      // Support cancels gravity at rest, rather than generating tiny bounces.
      if (Math.abs(this.vx) < p.settleSpeed) this.vx = 0;
    } else {
      // Linear air drag gives the balloon a gentle terminal fall speed while
      // allowing a strong upward impulse. Never snap an airborne apex to rest.
      const drag = Math.exp(-p.airDrag * dt);
      this.vy = p.airDrag > 0 ? this.vy * drag + p.gravity / p.airDrag * (1 - drag) : this.vy + p.gravity * dt;
      this.limitSpeed();
    }
    this.x += this.vx * this.scaleX * dt;
    this.y += this.vy * this.scaleY * dt;
    const left = this.bounds.x + this.radiusX, right = this.bounds.x + this.bounds.width - this.radiusX;
    const top = this.bounds.y + this.radiusY, bottom = this.bounds.y + this.bounds.height - this.radiusY;
    if (this.x < left) { this.x = left; this.vx = Math.abs(this.vx) * p.wallRestitution; }
    if (this.x > right) { this.x = right; this.vx = -Math.abs(this.vx) * p.wallRestitution; }
    if (p.bounds === "contained" && this.y < top) { this.y = top; this.vy = Math.abs(this.vy) * p.wallRestitution; }
    if (this.y > bottom) {
      this.y = bottom;
      const rebound = Math.abs(this.vy) * p.floorRestitution;
      this.vy = p.bounds === "gravity" && rebound < p.settleSpeed ? 0 : -rebound;
    }
  }

  private limitSpeed(): void {
    const speed = Math.hypot(this.vx, this.vy), max = this.profile.maxSpeed;
    if (speed > max) { this.vx *= max / speed; this.vy *= max / speed; }
  }
}
