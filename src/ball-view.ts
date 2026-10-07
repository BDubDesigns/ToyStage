import type { Ball } from "./ball";
import type { BallProfile } from "./ball-profiles";

// Shared by the overlay and small picker icons; no images or extra render loop.
export function drawBallAppearance(ctx: CanvasRenderingContext2D, profile: BallProfile, x: number, y: number, r: number): void {
  ctx.save();
  ctx.shadowColor = "#00000080";
  ctx.shadowBlur = r * 0.4;
  ctx.shadowOffsetY = r * 0.15;
  ctx.beginPath();
  ctx.ellipse(x, y, r * (profile.id === "balloon" ? 0.88 : 1), r, 0, 0, Math.PI * 2);
  const shade = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.05, x, y, r);
  profile.colors.forEach((color, i) => shade.addColorStop([0, 0.45, 1][i], color));
  ctx.fillStyle = shade;
  ctx.fill();
  ctx.shadowBlur = ctx.shadowOffsetY = 0;
  ctx.clip();
  ctx.lineWidth = r * 0.08;
  if (profile.id === "eight-ball") {
    ctx.fillStyle = "#fff8e9";
    ctx.beginPath(); ctx.arc(x, y, r * 0.47, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#111820";
    ctx.font = `bold ${r * 0.76}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("8", x, y + r * 0.035);
  } else if (profile.id === "basketball" || profile.id === "dodgeball") {
    ctx.strokeStyle = profile.id === "basketball" ? "#552919" : "#ffbfb780";
    ctx.beginPath(); ctx.moveTo(x - r, y); ctx.lineTo(x + r, y); ctx.moveTo(x, y - r); ctx.lineTo(x, y + r); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(x, y, r * 0.48, r, 0, 0, Math.PI * 2); ctx.stroke();
    if (profile.id === "dodgeball") {
      ctx.lineWidth = r * 0.025;
      ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.44, 0, 0, Math.PI * 2); ctx.stroke();
    }
  } else if (profile.id === "bowling-ball") {
    ctx.fillStyle = "#120e29";
    for (const [dx, dy] of [[-0.2, -0.28], [0.18, -0.22], [0.05, 0.13]]) {
      ctx.beginPath(); ctx.arc(x + r * dx, y + r * dy, r * 0.13, 0, Math.PI * 2); ctx.fill();
    }
  } else if (profile.id === "super-ball") {
    ctx.strokeStyle = "#f4ffcee0";
    ctx.lineWidth = r * 0.25;
    ctx.beginPath(); ctx.ellipse(x, y, r * 1.2, r * 0.25, -0.6, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.fillStyle = "#ffffff80";
  ctx.beginPath(); ctx.ellipse(x - r * 0.33, y - r * 0.4, r * 0.19, r * 0.11, -0.7, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  if (profile.id === "balloon") {
    ctx.fillStyle = profile.colors[1];
    ctx.beginPath(); ctx.moveTo(x, y + r * 0.9); ctx.lineTo(x - r * 0.13, y + r * 1.12); ctx.lineTo(x + r * 0.13, y + r * 1.12); ctx.closePath(); ctx.fill();
  }
}

export function getOffscreenIndicator(ball: Ball, width: number, height: number): { x: number; y: number; size: number } | null {
  if (!ball.aboveStage) return null;
  const size = Math.max(12, Math.min(width, height) * 0.065);
  const margin = size + 4;
  return { x: Math.max(margin, Math.min(width - margin, ball.x * width)), y: size + 4, size };
}

function drawOffscreenIndicator(ctx: CanvasRenderingContext2D, ball: Ball, marker: { x: number; y: number; size: number }): void {
  const { x, y, size } = marker;
  ctx.save();
  ctx.fillStyle = "#101619e8";
  ctx.strokeStyle = "#fff8e9";
  ctx.lineWidth = Math.max(1.5, size * 0.06);
  ctx.lineJoin = "round";
  // A high-contrast upward pointer containing the active ball's miniature.
  ctx.beginPath();
  ctx.moveTo(x, y - size); ctx.lineTo(x + size * 0.9, y - size * 0.1);
  ctx.lineTo(x + size * 0.65, y - size * 0.1); ctx.lineTo(x + size * 0.65, y + size);
  ctx.lineTo(x - size * 0.65, y + size); ctx.lineTo(x - size * 0.65, y - size * 0.1);
  ctx.lineTo(x - size * 0.9, y - size * 0.1); ctx.closePath(); ctx.fill(); ctx.stroke();
  drawBallAppearance(ctx, ball.profile, x, y + size * 0.28, size * 0.48);
  ctx.restore();
}

// A small Canvas overlay above the keyed toy makes the ball always visible.
// Driven by the compositor's frame callback, never its own animation loop.
export function drawBall(canvas: HTMLCanvasElement, ball: Ball, width: number, height: number, now: number, debug: boolean): void {
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, width, height);
  const x = ball.x * width, y = ball.y * height, r = ball.radiusX * width;
  if (debug) {
    const b = ball.bounds;
    ctx.strokeStyle = "#ffffff80";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(b.x * width, b.y * height, b.width * width, b.height * height);
    ctx.strokeStyle = "#7feaff55";
    ctx.strokeRect(x - 3 * r, y - 3 * r, 6 * r, 6 * r);
    ctx.setLineDash([]);
  }
  const marker = getOffscreenIndicator(ball, width, height);
  if (marker) { drawOffscreenIndicator(ctx, ball, marker); return; }
  drawBallAppearance(ctx, ball.profile, x, y, r);
  const sinceHit = now - ball.debug.hitTime;
  if (sinceHit < 300) {
    ctx.strokeStyle = `rgba(255,245,184,${1 - sinceHit / 300})`;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, r * (1.1 + sinceHit / 300 * 0.5), 0, Math.PI * 2); ctx.stroke();
  }
  if (!debug) return;
  ctx.strokeStyle = !ball.debug.fresh ? "#8e9d9b" : ball.debug.contact ? "#ff79bd" : "#7feaff";
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(x, y, r + 3, 0, Math.PI * 2); ctx.stroke();
  const arrow = (vx: number, vy: number, color: string): void => {
    const length = Math.hypot(vx, vy);
    if (length < 0.01) return;
    const scale = Math.min(width, height) * 0.12 / Math.max(1, length);
    const tx = x + vx * scale, ty = y + vy * scale, angle = Math.atan2(vy, vx);
    ctx.strokeStyle = ctx.fillStyle = color;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(tx, ty); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx - 7 * Math.cos(angle - 0.5), ty - 7 * Math.sin(angle - 0.5)); ctx.lineTo(tx - 7 * Math.cos(angle + 0.5), ty - 7 * Math.sin(angle + 0.5)); ctx.closePath(); ctx.fill();
  };
  if (ball.debug.motion) arrow(ball.debug.motion.x, ball.debug.motion.y, "#7feaff");
  if (sinceHit < 700) arrow(ball.debug.impulse.x, ball.debug.impulse.y, "#ff79bd");
}
