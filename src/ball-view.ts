import type { Ball } from "./ball";

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
  ctx.save();
  ctx.shadowColor = "#00000080";
  ctx.shadowBlur = r * 0.4;
  ctx.shadowOffsetY = r * 0.15;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  const shade = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.05, x, y, r);
  shade.addColorStop(0, "#fff4b3");
  shade.addColorStop(0.45, "#ffc354");
  shade.addColorStop(1, "#ed6b37");
  ctx.fillStyle = shade;
  ctx.fill();
  ctx.shadowBlur = ctx.shadowOffsetY = 0;
  ctx.clip();
  ctx.strokeStyle = "#fff7d5c0";
  ctx.lineWidth = r * 0.13;
  ctx.beginPath();
  ctx.ellipse(x, y, r * 0.38, r, -0.5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(x, y, r, r * 0.27, -0.5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "#ffffffb0";
  ctx.beginPath();
  ctx.ellipse(x - r * 0.33, y - r * 0.4, r * 0.19, r * 0.11, -0.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
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
