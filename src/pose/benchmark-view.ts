import type { CommonPose } from "./benchmark-joints";
import type { CameraRect } from "../compositor-layout";

const edges = [[1, 2], [1, 7], [2, 8], [7, 8], [1, 3], [3, 5], [2, 4], [4, 6], [7, 9], [9, 11], [8, 10], [10, 12]];
// Raw measured joints for BOTH models; no render extrapolation or extra smoothing.
export function drawBenchmark(canvas: HTMLCanvasElement, pose: CommonPose | null, rect: CameraRect): void {
  const ctx = canvas.getContext("2d")!;
  const w = canvas.width, h = canvas.height, short = Math.min(w, h);
  ctx.fillStyle = "#0e1f28"; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "#86b2ae60"; ctx.lineWidth = 1;
  ctx.strokeRect(rect.x * w, rect.y * h, rect.width * w, rect.height * h);
  if (!pose) return;
  ctx.lineWidth = Math.max(3, short * 0.01); ctx.lineCap = "round";
  for (const [a, b] of edges) {
    const p = pose.joints[a], q = pose.joints[b];
    if (!p?.reliable || !q?.reliable) continue;
    ctx.strokeStyle = a % 2 ? "#85e5ef" : "#ffb09b";
    ctx.beginPath(); ctx.moveTo(p.x * w, p.y * h); ctx.lineTo(q.x * w, q.y * h); ctx.stroke();
  }
  for (const joint of pose.joints) {
    if (!joint.reliable) continue;
    const pointer = ["nose", "leftWrist", "rightWrist"].includes(joint.name);
    ctx.fillStyle = joint.name === "leftWrist" ? "#85e5ef" : joint.name === "rightWrist" ? "#ffb09b" : "#d3f591";
    ctx.beginPath(); ctx.arc(joint.x * w, joint.y * h, short * (pointer ? 0.018 : 0.007), 0, Math.PI * 2); ctx.fill();
  }
}
