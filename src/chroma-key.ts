import { getCameraRect } from "./compositor-layout";

export type RGB = readonly [number, number, number];

export interface ChromaKeySettings {
  enabled: boolean;
  color: RGB;
  tolerance: number;
  softness: number;
  despill: number;
  showMask: boolean;
}

export function defaultChromaKeySettings(): ChromaKeySettings {
  return { enabled: true, color: [0.08, 0.8, 0.12], tolerance: 0.28, softness: 0.12, despill: 0.65, showMask: false };
}

export function colorFromHex(hex: string): RGB {
  const channel = (offset: number) => parseInt(hex.slice(offset, offset + 2), 16) / 255;
  return [channel(1), channel(3), channel(5)];
}

export function colorToHex(color: RGB): string {
  return "#" + color.map((channel) => Math.round(channel * 255).toString(16).padStart(2, "0")).join("");
}

// Input is normalized to the CSS stage, with y down (pointer coordinates).
// Return source-video coordinates using the exact fit/mirror of the shader.
export function getSamplePoint(x: number, y: number, stageWidth: number, stageHeight: number, videoWidth: number, videoHeight: number, mirrored: boolean): { x: number; y: number } | null {
  if (stageWidth <= 0 || stageHeight <= 0 || videoWidth <= 0 || videoHeight <= 0) return null;
  const rect = getCameraRect(stageWidth, stageHeight, videoWidth, videoHeight);
  let u = (x - rect.x) / rect.width;
  const v = (1 - y - rect.y) / rect.height;
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  if (mirrored) u = 1 - u;
  return { x: Math.min(videoWidth - 1, Math.floor(u * videoWidth)), y: Math.min(videoHeight - 1, Math.floor((1 - v) * videoHeight)) };
}

// A one-off 5x5 patch read on user request, never a per-frame CPU operation.
// The temporary pixels are neither retained nor serialized.
export function sampleVideoColor(video: HTMLVideoElement, point: { x: number; y: number }): RGB {
  const patch = document.createElement("canvas");
  patch.width = Math.min(5, video.videoWidth);
  patch.height = Math.min(5, video.videoHeight);
  const context = patch.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Color sampling is unavailable. Choose the screen color manually instead.");
  const x = Math.max(0, Math.min(video.videoWidth - patch.width, point.x - Math.floor(patch.width / 2)));
  const y = Math.max(0, Math.min(video.videoHeight - patch.height, point.y - Math.floor(patch.height / 2)));
  context.drawImage(video, x, y, patch.width, patch.height, 0, 0, patch.width, patch.height);
  const pixels = context.getImageData(0, 0, patch.width, patch.height).data;
  const sum = [0, 0, 0];
  for (let i = 0; i < pixels.length; i += 4) {
    for (let channel = 0; channel < 3; channel++) sum[channel] += pixels[i + channel];
  }
  const divisor = pixels.length / 4 * 255;
  return [sum[0] / divisor, sum[1] / divisor, sum[2] / divisor];
}
