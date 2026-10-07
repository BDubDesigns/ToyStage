export interface CameraRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Stage-normalized coordinates; contain the whole frame with a small border so
// the scene background stays visible even when camera and stage aspects match.
export function getCameraRect(stageWidth: number, stageHeight: number, videoWidth: number, videoHeight: number): CameraRect {
  const scale = Math.min(stageWidth * 0.92 / videoWidth, stageHeight * 0.92 / videoHeight);
  const width = videoWidth * scale / stageWidth;
  const height = videoHeight * scale / stageHeight;
  return { x: (1 - width) / 2, y: (1 - height) / 2, width, height };
}

export function getRenderSize(cssWidth: number, cssHeight: number, pixelRatio: number): { width: number; height: number } {
  const width = Math.max(1, cssWidth);
  const height = Math.max(1, cssHeight);
  // Bound the drawing buffer at a landscape OR portrait 720p budget. Do not
  // blindly render at a flagship phone's device pixel ratio.
  const scale = Math.min(Math.max(1, pixelRatio), 1280 / Math.max(width, height), 720 / Math.min(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
