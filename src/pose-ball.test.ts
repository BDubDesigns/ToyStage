import { describe, expect, it } from "vitest";
import { Ball } from "./ball";
import { BALL_PROFILES } from "./ball-profiles";
import type { BallType } from "./ball-profiles";
import { ForegroundMask } from "./foreground-mask";
import { getCameraRect } from "./compositor-layout";
import { getOffscreenIndicator } from "./ball-view";
import { PoseBallContacts, poseColliders, sweptContact, toBallUnits } from "./pose-ball";
import { JOINT, mapImagePoint } from "./pose/pose-types";
import type { PoseFrame, PoseLandmark } from "./pose/pose-types";
import { PoseSmoother } from "./pose/pose-smoothing";

interface Point { x: number; y: number; reliable?: boolean; zeroVelocity?: boolean }
// Scripted timestamped snapshots, with exactly the same x/y velocity contract
// as the real tracker. Only torso anchors and explicitly supplied limbs exist.
function samples(ball: Ball) {
  let previous: Record<number, Point> = {}, previousAt = 0, id = 0;
  return (at: number, limbs: Record<number, Point> = {}): PoseFrame => {
    const input: Record<number, Point> = {
      [JOINT.leftShoulder]: { x: 0.35, y: 0.25 }, [JOINT.rightShoulder]: { x: 0.65, y: 0.25 },
      [JOINT.leftHip]: { x: 0.4, y: 0.65 }, [JOINT.rightHip]: { x: 0.6, y: 0.65 }, ...limbs,
    };
    const landmarks: PoseLandmark[] = Array.from({ length: 33 }, (_, i) => {
      const p = input[i] ?? { x: 0, y: 0, reliable: false }, old = previous[i];
      const reliable = p.reliable !== false;
      const dt = (at - previousAt) / 1000;
      const velocity = old && old.reliable !== false && !p.zeroVelocity && dt > 0
        ? { vx: (p.x - old.x) / dt, vy: (p.y - old.y) / dt } : { vx: 0, vy: 0 };
      return { x: p.x, y: p.y, ...velocity, reliable, reliability: reliable ? "reliable" : "low-visibility",
        raw: { x: (p.x - ball.bounds.x) / ball.bounds.width, y: (p.y - ball.bounds.y) / ball.bounds.height,
          visibility: reliable ? 1 : 0.1, presence: 1 } };
    });
    previous = input; previousAt = at;
    return { frameId: ++id, capturedAt: at, completedAt: at, receivedAt: at, mediaTime: at / 1000,
      captureMs: 0, inferenceMs: 0, roundTripMs: 0, poses: [{ state: "partial", landmarks }] };
  };
}
const hand = (x: number, y = 0.45): Record<number, Point> => ({ [JOINT.leftWrist]: { x, y } });
function strike(interval = 100, type: BallType = "eight-ball", start = 0.4, end = 0.43) {
  const ball = new Ball(type), contacts = new PoseBallContacts(), frame = samples(ball);
  contacts.tick(100, frame(100, hand(start)), ball);
  contacts.tick(100 + interval, frame(100 + interval, hand(end)), ball);
  return { ball, contacts, frame };
}

describe("Pose coordinates and swept geometry", () => {
  it.each([[1280, 720], [720, 1280], [390, 292]])("converts points and velocities on %ix%i without changing physical distances", (w, h) => {
    const ball = new Ball(); ball.layout(w, h, getCameraRect(w, h, w, h));
    const p = toBallUnits({ x: 0.3, y: 0.4 }, ball.scaleX, ball.scaleY);
    expect(p.x * Math.min(w, h)).toBeCloseTo(0.3 * w);
    expect(p.y * Math.min(w, h)).toBeCloseTo(0.4 * h);
    const velocity = toBallUnits({ x: ball.scaleX * 0.8, y: ball.scaleY * -0.6 }, ball.scaleX, ball.scaleY);
    expect(Math.hypot(velocity.x, velocity.y)).toBeCloseTo(1);
  });

  it("takes the entering side of a through-sweep, rejects near misses and handles relative ball motion", () => {
    const ball = { x: 0.5, y: 0.5 };
    expect(sweptContact({ x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }, ball, ball, 0.1)).toEqual({ x: 1, y: 0 });
    expect(sweptContact({ x: 0.2, y: 0.61 }, { x: 0.8, y: 0.61 }, ball, ball, 0.1)).toBeNull();
    expect(sweptContact(ball, ball, { x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }, 0.1)).toEqual({ x: -1, y: 0 });
    expect(sweptContact(ball, ball, ball, ball, 0.1)).toBeNull();
  });

  it("uses mapped mirrored coordinates exactly once, including hit direction", () => {
    for (const mirrored of [false, true]) {
      const ball = new Ball(); ball.layout(1280, 720, getCameraRect(1280, 720, 720, 1280));
      const rect = ball.bounds, contacts = new PoseBallContacts(), frame = samples(ball);
      const imagePoint = (x: number) => mapImagePoint({ x, y: 0.45 }, { rect, mirrored });
      ball.reset(0.5, rect.y + rect.height * 0.45);
      contacts.tick(100, frame(100, { [JOINT.leftWrist]: imagePoint(0.1) }), ball);
      contacts.tick(200, frame(200, { [JOINT.leftWrist]: imagePoint(0.4) }), ball);
      expect(ball.debug.hits).toBe(1);
      expect(Math.sign(ball.vx)).toBe(mirrored ? -1 : 1);
    }
  });

  it("produces equal strength for equal shorter-edge strikes in portrait and landscape", () => {
    const strengths: number[] = [];
    for (const [w, h] of [[1280, 720], [720, 1280]]) {
      const ball = new Ball(); ball.layout(w, h, getCameraRect(w, h, w, h));
      const contacts = new PoseBallContacts(), frame = samples(ball);
      contacts.tick(100, frame(100, hand(ball.x - 0.1 * ball.scaleX, ball.y)), ball);
      contacts.tick(200, frame(200, hand(ball.x - 0.07 * ball.scaleX, ball.y)), ball);
      expect(ball.debug.hits).toBe(1); strengths.push(Math.hypot(ball.debug.impulse.x, ball.debug.impulse.y));
    }
    expect(strengths[0]).toBeCloseTo(strengths[1], 9);
  });
});

describe("Pose body-part ball contacts", () => {
  it.each(BALL_PROFILES.map(p => p.id))("%s responds more strongly to faster punches within its material caps", type => {
    const radius = new Ball(type).radius + 0.026;
    const slow = strike(100, type, 0.5 - radius - 0.02, 0.5 - radius + 0.01).ball;
    const fast = strike(50, type, 0.5 - radius - 0.02, 0.5 - radius + 0.01).ball;
    expect(slow.debug.hits).toBe(1); expect(fast.debug.hits).toBe(1);
    expect(fast.debug.impulse.x).toBeGreaterThan(slow.debug.impulse.x);
    expect(fast.vx).toBeGreaterThan(0);
    expect(Math.hypot(fast.vx, fast.vy)).toBeLessThanOrEqual(fast.profile.maxSpeed + 1e-9);
  });

  it.each([JOINT.leftWrist, JOINT.rightWrist, JOINT.leftAnkle, JOINT.rightAnkle, JOINT.nose])("joint %i can deliberately strike, including a lifted foot and downward header", joint => {
    const ball = new Ball(), contacts = new PoseBallContacts(), frame = samples(ball);
    const start = joint === JOINT.nose ? { x: 0.5, y: 0.25 } : { x: 0.5, y: 0.58 };
    const end = joint === JOINT.nose ? { x: 0.5, y: 0.38 } : { x: 0.5, y: 0.52 };
    contacts.tick(100, frame(100, { [joint]: start }), ball);
    contacts.tick(200, frame(200, { [joint]: end }), ball);
    expect(ball.debug.hits).toBe(1);
    expect(Math.sign(ball.vy)).toBe(joint === JOINT.nose ? 1 : -1);
  });

  it("catches a quick hand that has already crossed to the far side", () => {
    const { ball } = strike(50, "eight-ball", 0.35, 0.65);
    expect(ball.debug.hits).toBe(1); expect(ball.vx).toBeGreaterThan(0);
  });

  it("rejects barely moving entry, receding contact and glancing near misses", () => {
    expect(strike(100, "eight-ball", 0.416, 0.421).ball.debug.hits).toBe(0);
    const ball = new Ball(), contacts = new PoseBallContacts(), frame = samples(ball);
    contacts.tick(100, frame(100, hand(0.4, 0.56)), ball);
    contacts.tick(200, frame(200, hand(0.6, 0.56)), ball);
    expect(ball.debug.hits).toBe(0);
  });

  it("bounces an approaching ball off a stationary hand rather than letting it tunnel", () => {
    const ball = new Ball(), contacts = new PoseBallContacts(), frame = samples(ball);
    ball.x = 0.3;
    contacts.tick(100, frame(100, hand(0.5)), ball);
    ball.vx = 1.8;
    for (let at = 150; at <= 250; at += 50) contacts.tick(at, frame(at, hand(0.5)), ball);
    expect(ball.debug.hits).toBe(1); expect(ball.vx).toBeLessThan(0);
  });

  it("seeds initial overlap and never pumps a stationary hand or head", () => {
    for (const joint of [JOINT.leftWrist, JOINT.nose]) {
      const ball = new Ball(), contacts = new PoseBallContacts(), frame = samples(ball);
      for (let at = 100; at < 3000; at += 50) contacts.tick(at, frame(at, { [joint]: { x: ball.x, y: ball.y } }), ball);
      expect(ball.debug.hits).toBe(0); expect(ball.vx).toBe(0); expect(ball.vy).toBe(0);
    }
  });

  it("does not re-consume a frame at render cadence or under replay/out-of-order input", () => {
    const { ball, contacts, frame } = strike();
    const same = frame(250, hand(0.43)); contacts.tick(250, same, ball);
    for (let now = 260; now <= 400; now += 10) contacts.tick(now, same, ball);
    const old = { ...same, capturedAt: 225, frameId: 999 };
    contacts.tick(400, old, ball);
    expect(ball.debug.hits).toBe(1);
  });

  it("requires two clear samples and cooldown, then rearms for a deliberate second strike", () => {
    const { ball, contacts, frame } = strike();
    const park = () => { ball.x = 0.5; ball.y = 0.45; ball.vx = ball.vy = 0; };
    park(); contacts.tick(250, frame(250, hand(0.39)), ball); // One clear sample.
    contacts.tick(300, frame(300, hand(0.44)), ball);
    expect(ball.debug.hits).toBe(1);
    contacts.tick(350, frame(350, hand(0.35)), ball);
    contacts.tick(400, frame(400, hand(0.36)), ball);
    contacts.tick(450, frame(450, hand(0.43)), ball);
    expect(ball.debug.hits).toBe(2);
    park();
    contacts.tick(470, frame(470, hand(0.35)), ball);
    contacts.tick(490, frame(490, hand(0.36)), ball);
    contacts.tick(510, frame(510, hand(0.43)), ball); // Only 60 ms after hit.
    expect(ball.debug.hits).toBe(2);
  });

  it("sequential hands are independent even within the other hand's cooldown", () => {
    const ball = new Ball(), contacts = new PoseBallContacts(), frame = samples(ball);
    const pair = (left: number, right: number) => ({ ...hand(left), [JOINT.rightWrist]: { x: right, y: 0.45 } });
    contacts.tick(100, frame(100, pair(0.4, 0.65)), ball);
    contacts.tick(200, frame(200, pair(0.43, 0.65)), ball);
    ball.x = 0.5; ball.vx = ball.vy = 0;
    contacts.tick(250, frame(250, pair(0.43, 0.57)), ball);
    expect(ball.debug.hits).toBe(2); expect(contacts.lastHit?.part).toBe("right hand");
    expect(ball.vx).toBeLessThan(0);
  });

  it("works with actual smoothing output and suppresses smoother-seeded teleports", () => {
    const ball = new Ball(), contacts = new PoseBallContacts(), input = samples(ball), smoother = new PoseSmoother();
    const rawFrame = (at: number, x: number) => {
      const frame = input(at, hand(x));
      return { ...frame, poses: [smoother.update(frame.poses[0].landmarks.map(p => p.raw), at, { rect: ball.bounds, mirrored: false })] };
    };
    contacts.tick(100, rawFrame(100, 0.35), ball);
    contacts.tick(150, rawFrame(150, 0.48), ball);
    expect(ball.debug.hits).toBe(1);
    contacts.reset(); ball.reset();
    smoother.reset();
    contacts.tick(200, rawFrame(200, 0.1), ball);
    contacts.tick(250, rawFrame(250, 0.6), ball);
    expect(ball.debug.hits).toBe(0);
  });
});

describe("Pose loss, stale input and lifecycle safety", () => {
  it.each(["occluded", "offscreen", "invalid", "missing"])("%s limb disappears immediately and reacquisition seeds contact", reason => {
    const ball = new Ball(), contacts = new PoseBallContacts(), frame = samples(ball);
    contacts.tick(100, frame(100, hand(0.4)), ball);
    const bad: Record<number, Point> = reason === "missing" ? {} : hand(reason === "offscreen" ? -0.1 : reason === "invalid" ? NaN : 0.43);
    if (reason === "occluded") bad[JOINT.leftWrist].reliable = false;
    contacts.tick(150, frame(150, bad), ball);
    expect(contacts.colliders.some(c => c.part === "left hand")).toBe(false);
    contacts.tick(200, frame(200, hand(0.43)), ball);
    contacts.tick(250, frame(250, hand(0.43)), ball);
    expect(ball.debug.hits).toBe(0);
  });

  it("switching from ankle fallback to ankle/toe center does not synthesize a kick", () => {
    const ball = new Ball(), contacts = new PoseBallContacts(), frame = samples(ball);
    contacts.tick(100, frame(100, { [JOINT.leftAnkle]: { x: 0.35, y: 0.45 } }), ball);
    contacts.tick(150, frame(150, { [JOINT.leftAnkle]: { x: 0.35, y: 0.45 }, [JOINT.leftFoot]: { x: 0.55, y: 0.45 } }), ball);
    expect(ball.debug.hits).toBe(0);
  });

  it.each(["gap", "teleport", "zeroed velocity", "old sample", "future sample"])("rejects %s instead of a phantom punch", reason => {
    const ball = new Ball(), contacts = new PoseBallContacts(), frame = samples(ball);
    contacts.tick(100, frame(100, hand(reason === "teleport" ? 0.05 : 0.35)), ball);
    // A 200 ms gap is now expected at 5 Hz; use >260 ms for true loss.
    const at = reason === "gap" ? 400 : reason === "future sample" ? 250 : 150;
    const input = hand(reason === "teleport" ? 0.6 : 0.45);
    if (reason === "zeroed velocity") input[JOINT.leftWrist].zeroVelocity = true;
    const now = reason === "old sample" ? 350 : reason === "future sample" ? 200 : at;
    contacts.tick(now, frame(at, input), ball);
    expect(ball.debug.hits).toBe(0);
  });

  it("brief misses preserve gravity; sustained absence pauses and resumes without a time jump or hit", () => {
    const ball = new Ball("basketball"), contacts = new PoseBallContacts(), frame = samples(ball);
    contacts.tick(100, frame(100), ball);
    contacts.tick(150, null, ball);
    expect(ball.y).toBeGreaterThan(0.45);
    const empty = { ...frame(200), poses: [] };
    contacts.tick(200, empty, ball);
    expect(ball.debug.fresh).toBe(true);
    const beforePause = [ball.x, ball.y, ball.vx, ball.vy];
    contacts.tick(450, empty, ball);
    expect([ball.x, ball.y, ball.vx, ball.vy]).toEqual(beforePause);
    expect(ball.debug.fresh).toBe(false);
    contacts.tick(5000, frame(5000, hand(ball.x, ball.y)), ball);
    expect([ball.x, ball.y, ball.vx, ball.vy]).toEqual(beforePause);
    expect(ball.debug.hits).toBe(0);
  });

  it("explicit hide/device/mode/reset invalidation seeds the next sample without a velocity bridge", () => {
    const { ball, contacts, frame } = strike();
    contacts.reset(); ball.pause();
    const before = [ball.x, ball.y, ball.vx, ball.vy];
    contacts.tick(10000, frame(10000, hand(ball.x, ball.y)), ball);
    expect([ball.x, ball.y, ball.vx, ball.vy]).toEqual(before);
    expect(ball.debug.hits).toBe(1);
    ball.reset(); contacts.reset();
    contacts.tick(10050, frame(10050, hand(ball.x, ball.y)), ball);
    expect(ball.debug.hits).toBe(0);
  });

  it("does not fabricate head contact when anchors are missing or the pose is unusable", () => {
    const ball = new Ball(), contacts = new PoseBallContacts(), frame = samples(ball);
    const input = frame(100, { [JOINT.nose]: { x: 0.5, y: 0.4 }, [JOINT.leftShoulder]: { x: 0.35, y: 0.25, reliable: false } });
    expect(poseColliders(input.poses[0], ball).some(c => c.part === "head")).toBe(false);
    contacts.tick(100, { ...input, poses: [{ ...input.poses[0], state: "unusable" }] }, ball);
    expect(ball.debug.fresh).toBe(false); expect(contacts.colliders).toEqual([]);
  });
});

describe("Shared ball physics regressions", () => {
  it.each(BALL_PROFILES.map(p => p.id))("%s mask-free integration exactly matches fresh-mask integration", type => {
    const mask = new ForegroundMask(), green = new Ball(type), pose = new Ball(type);
    green.vx = pose.vx = 1; green.vy = pose.vy = -1;
    for (let time = 100; time < 6000; time += 33) {
      mask.update(new Uint8Array(16 * 9 * 4), 16, 9, time);
      green.tick(time, mask); pose.advance(time);
      expect([pose.x, pose.y, pose.vx, pose.vy]).toEqual([green.x, green.y, green.vx, green.vy]);
    }
  });

  it.each(BALL_PROFILES.filter(p => p.bounds === "gravity").map(p => p.id))("%s has no Pose ceiling, shows the indicator, returns and retains floor/side bounds", type => {
    const ball = new Ball(type), contacts = new PoseBallContacts(), frame = samples(ball);
    ball.reset(0.9, 0.1); ball.applyImpulse(100, { x: 1, y: -5 });
    let above = false, returned = false;
    for (let time = 100; time < 25000; time += 33) {
      contacts.tick(time, frame(time), ball);
      if (ball.aboveStage) { above = true; expect(getOffscreenIndicator(ball, 720, 720)).not.toBeNull(); }
      if (above && !ball.aboveStage) returned = true;
      expect(ball.x).toBeGreaterThanOrEqual(ball.radiusX);
      expect(ball.x).toBeLessThanOrEqual(1 - ball.radiusX);
      expect(ball.y).toBeLessThanOrEqual(1 - ball.radiusY);
    }
    expect(above).toBe(true); expect(returned).toBe(true);
  });

  it.each(BALL_PROFILES.map(p => p.id))("%s safely bounds explicit impulses and ignores nonfinite values", type => {
    const ball = new Ball(type);
    ball.applyImpulse(100, { x: NaN, y: 1 });
    ball.applyImpulse(Infinity, { x: 1, y: 1 });
    expect(ball.debug.hits).toBe(0);
    ball.applyImpulse(150, { x: 1000, y: -1000 });
    expect(Math.hypot(ball.vx, ball.vy)).toBeCloseTo(ball.profile.maxSpeed);
    expect(Math.hypot(ball.debug.impulse.x, ball.debug.impulse.y)).toBeLessThanOrEqual(ball.profile.maxSpeed * 2 + 1e-9);
  });
});

describe("Measured low-rate pose delivery and ball-time alignment", () => {
  it.each([5, 8, 10, 12].flatMap(hz => [70, 120].map(delay => ({ hz, delay }))))(
    "$hz Hz inference with $delay ms latency preserves a real wrist strike",
    ({ hz, delay }) => {
      const ball = new Ball(), contacts = new PoseBallContacts(), frame = samples(ball);
      const period = Math.round(1000 / hz), captureA = 100, captureB = captureA + period;
      const initial = frame(captureA, hand(0.35));
      const incoming = frame(captureB, hand(0.46));
      const deliveredA = captureA + delay, deliveredB = captureB + delay;
      contacts.tick(deliveredA, initial, ball);
      // A real 30 fps renderer repeats the most recent result while inference
      // is busy. It must not destroy contact history at 180 ms sample age.
      for (let now = deliveredA + 33; now < deliveredB; now += 33) {
        contacts.tick(now, initial, ball);
      }
      contacts.tick(deliveredB, incoming, ball);
      expect(ball.debug.hits).toBe(1);
      expect(ball.vx).toBeGreaterThan(0);
    },
  );

  it("keeps collision history through a 5 Hz / 120 ms sample and never fabricates a held hit", () => {
    const ball = new Ball(), contacts = new PoseBallContacts(), frame = samples(ball);
    const first = frame(100, hand(0.37)), second = frame(300, hand(0.37));
    contacts.tick(220, first, ball);
    for (let now = 253; now <= 385; now += 33) contacts.tick(now, first, ball);
    contacts.tick(420, second, ball);
    expect(ball.debug.hits).toBe(0);
    for (let now = 453; now < 615; now += 33) contacts.tick(now, second, ball);
    contacts.tick(620, frame(500, hand(0.37)), ball);
    expect(ball.debug.hits).toBe(0);
  });

  it("calculates delayed swept contact against ball's capture-time location", () => {
    const ball = new Ball(), contacts = new PoseBallContacts(), frame = samples(ball);
    ball.vx = 0.45; // Ball moves visibly during the 120 ms inference delay.
    const initial = frame(100, hand(0.32));
    const incoming = frame(300, hand(0.465));
    contacts.tick(220, initial, ball);
    for (let now = 253; now < 420; now += 33) contacts.tick(now, initial, ball);
    // At receipt, the displayed ball is already beyond the wrist; at capture,
    // the wrist's sweep intersected it.
    expect(ball.x - 0.465).toBeGreaterThan(ball.radius + 0.026);
    contacts.tick(420, incoming, ball);
    expect(ball.debug.hits).toBe(1);
    expect(contacts.lastHit?.part).toBe("left hand");
  });

  it("retains sample velocities beyond 150 ms but seeds long gaps and teleports", () => {
    const ball = new Ball(), input = samples(ball), smoother = new PoseSmoother();
    const raw = (at: number, x: number) => input(at, hand(x)).poses[0].landmarks.map(p => p.raw);
    smoother.update(raw(100, 0.35), 100, { rect: ball.bounds, mirrored: false });
    const valid = smoother.update(raw(300, 0.46), 300, { rect: ball.bounds, mirrored: false });
    expect(valid.landmarks[JOINT.leftWrist].vx).toBeGreaterThan(0.3);
    const gap = smoother.update(raw(650, 0.5), 650, { rect: ball.bounds, mirrored: false });
    expect(gap.landmarks[JOINT.leftWrist].vx).toBe(0);
    const jump = smoother.update(raw(700, 0.95), 700, { rect: ball.bounds, mirrored: false });
    expect(jump.landmarks[JOINT.leftWrist].vx).toBe(0);
  });

  it("stale or absent snapshots cannot bridge a lost tracked person into a punch", () => {
    const ball = new Ball(), contacts = new PoseBallContacts(), frame = samples(ball);
    const initial = frame(100, hand(0.35));
    contacts.tick(220, initial, ball);
    for (let now = 253; now <= 715; now += 33) contacts.tick(now, initial, ball);
    contacts.tick(820, frame(700, hand(0.46)), ball);
    expect(ball.debug.hits).toBe(0);
    const missing = frame(900, hand(0.47));
    contacts.tick(1020, { ...missing, poses: [] }, ball);
    contacts.tick(1220, frame(1100, hand(0.51)), ball);
    expect(ball.debug.hits).toBe(0);
  });
});
