import { BODY_CONNECTIONS, JOINT } from "./pose-types";
import type { PoseFrame } from "./pose-types";
import type { CameraRect } from "../compositor-layout";
import { headRadius } from "./pose-geometry";
import { PoseVisualFilter } from "./pose-visual";

export class StickFigureView {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly visual = new PoseVisualFilter();

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("A Canvas 2D stage is needed for Pose Mode.");
    this.ctx = ctx;
  }

  draw(frame: PoseFrame | null, rect: CameraRect, now = performance.now()): void {
    const { ctx, canvas } = this;
    const w = canvas.width, h = canvas.height, short = Math.min(w, h);
    const gradient = ctx.createRadialGradient(w / 2, h * 0.4, 0, w / 2, h / 2, Math.max(w, h));
    gradient.addColorStop(0, "#203339"); gradient.addColorStop(1, "#0b151e");
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#86b2ae30"; ctx.lineWidth = 1;
    ctx.setLineDash([4, 10]);
    ctx.strokeRect(rect.x * w, rect.y * h, rect.width * w, rect.height * h);
    ctx.setLineDash([]);
    ctx.strokeStyle = "#c4ee7940";
    ctx.beginPath(); ctx.moveTo(rect.x * w, (rect.y + rect.height) * h); ctx.lineTo((rect.x + rect.width) * w, (rect.y + rect.height) * h); ctx.stroke();
    const pose = frame?.poses.find((value) => value.state !== "unusable");
    const points = this.visual.positions(frame, now);
    if (!pose || !points) return;
    ctx.lineCap = ctx.lineJoin = "round";
    const line = (ax: number, ay: number, bx: number, by: number, color: string, alpha: number) => {
      ctx.globalAlpha = alpha;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
      ctx.strokeStyle = "#071219"; ctx.lineWidth = Math.max(7, short * 0.021); ctx.stroke();
      ctx.strokeStyle = color; ctx.lineWidth = Math.max(4, short * 0.012); ctx.stroke();
    };
    for (const [a, b] of BODY_CONNECTIONS) {
      const p = points[a], q = points[b];
      if (!p.reliable || !q.reliable) continue;
      const confidence = Math.min(p.raw.visibility ?? 0, q.raw.visibility ?? 0, p.raw.presence ?? 1, q.raw.presence ?? 1);
      const color = a === 11 && b === 12 || a === 11 && b === 23 || a === 12 && b === 24 || a === 23 && b === 24 ? "#d3f591" : a % 2 ? "#85e5ef" : "#ffb09b";
      line(p.x * w, p.y * h, q.x * w, q.y * h, color, 0.35 + confidence * 0.65);
    }
    const nose = points[JOINT.nose], left = points[JOINT.leftShoulder], right = points[JOINT.rightShoulder];
    if (nose.reliable && left.reliable && right.reliable) {
      const cx = nose.x * w, cy = nose.y * h;
      const radius = headRadius(pose, short / w, short / h) * short;
      const sx = (left.x + right.x) * w / 2, sy = (left.y + right.y) * h / 2;
      const length = Math.hypot(sx - cx, sy - cy) || 1;
      line(cx + (sx - cx) * radius / length, cy + (sy - cy) * radius / length, sx, sy, "#d3f591", nose.raw.visibility ?? 1);
      ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fillStyle = "#182c33"; ctx.fill(); ctx.strokeStyle = "#e6fac5";
      ctx.lineWidth = Math.max(3, short * 0.008); ctx.stroke();
    }
    for (const i of [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) {
      const point = points[i];
      if (!point.reliable) continue;
      ctx.globalAlpha = 0.5 + (point.raw.visibility ?? 0) * 0.5;
      ctx.beginPath(); ctx.arc(point.x * w, point.y * h, Math.max(3, short * 0.009), 0, Math.PI * 2);
      ctx.fillStyle = "#eafbf1"; ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}
