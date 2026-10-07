import "./styles.css";
import {
  getCameraErrorMessage,
  getUnsupportedCameraMessage,
  isCameraApiAvailable,
  requestCamera,
  shouldMirrorPreview,
  supportsWebGL2,
} from "./camera";
import { WebGLCompositor } from "./compositor";
import type { RenderDiagnostics } from "./compositor";

const cameraButton = getElement<HTMLButtonElement>("camera-button");
const cameraState = getElement<HTMLElement>("camera-state");
const cameraStateLabel = getElement<HTMLElement>("camera-state-label");
const video = getElement<HTMLVideoElement>("stage-video");
const canvas = getElement<HTMLCanvasElement>("stage-canvas");
const emptyState = getElement<HTMLElement>("empty-state");
const emptyTitle = getElement<HTMLElement>("empty-title");
const stageMessage = getElement<HTMLElement>("stage-message");
const liveOverlay = getElement<HTMLElement>("live-overlay");
const videoSize = getElement<HTMLElement>("video-size");
const frameRate = getElement<HTMLElement>("frame-rate");
const cameraName = getElement<HTMLElement>("camera-name");
const renderRate = getElement<HTMLElement>("render-rate");
const frameTime = getElement<HTMLElement>("frame-time");
const submissionTime = getElement<HTMLElement>("submission-time");
const renderSize = getElement<HTMLElement>("render-size");
const cameraView = getElement<HTMLElement>("camera-view");

let activeStream: MediaStream | null = null;
let renderer: WebGLCompositor | null = null;
let session: AbortController | null = null;
let removeTrackListener: (() => void) | null = null;

getElement<HTMLElement>("browser-name").textContent = getBrowserName();
const webglAvailable = supportsWebGL2();
getElement<HTMLElement>("webgl-status").textContent = webglAvailable ? "Available" : "Unavailable";
getElement<HTMLElement>("webgl-status").dataset.state = webglAvailable ? "available" : "unavailable";

cameraButton.addEventListener("click", () => {
  if (activeStream) {
    stopCamera();
    return;
  }
  void startCamera();
});

async function startCamera(): Promise<void> {
  const attempt = new AbortController();
  session = attempt;
  setState("requesting", "Requesting access");
  cameraButton.disabled = true;
  cameraButton.textContent = "Requesting…";
  emptyTitle.textContent = "Waiting for permission";
  stageMessage.textContent = "Allow camera access in your browser to show the live stage.";
  stageMessage.removeAttribute("data-error");

  if (!isCameraApiAvailable(navigator.mediaDevices)) {
    releaseStream();
    showFailure(new Error("Camera API unavailable"), !window.isSecureContext);
    return;
  }

  let stream: MediaStream | null = null;
  let renderingError = false;
  try {
    if (!webglAvailable) {
      throw new Error("WebGL 2 is unavailable. Try a recent browser with hardware acceleration enabled.");
    }
    stream = await requestCamera(navigator.mediaDevices);
    if (attempt.signal.aborted) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    const track = stream.getVideoTracks()[0];
    if (!track) {
      throw new Error("Camera stream did not include a video track");
    }

    activeStream = stream;
    video.srcObject = stream;
    await waitForMetadata(video, attempt.signal);
    await video.play();
    if (attempt.signal.aborted) return;

    renderingError = true;
    renderer = new WebGLCompositor(canvas, video, {
      mirrored: shouldMirrorPreview(track.getSettings().facingMode),
      onDiagnostics: updateRenderDiagnostics,
      onError: (error) => {
        releaseStream();
        showFailure(error, false, true);
      },
    });
    renderer.start();
    canvas.hidden = false;
    emptyState.hidden = true;
    liveOverlay.hidden = false;
    updateDiagnostics(track);
    setState("live", "Camera live");
    cameraButton.disabled = false;
    cameraButton.textContent = "Stop camera";

    const onEnded = () => {
      if (activeStream !== stream) {
        return;
      }
      releaseStream();
      showFailure(new DOMException("Camera track ended", "NotReadableError"));
    };
    track.addEventListener("ended", onEnded, { once: true });
    removeTrackListener = () => track.removeEventListener("ended", onEnded);
  } catch (error) {
    stream?.getTracks().forEach((track) => track.stop());
    if (attempt.signal.aborted) return;
    releaseStream();
    showFailure(error, false, renderingError || !webglAvailable);
  }
}

function stopCamera(): void {
  releaseStream();
  canvas.hidden = true;
  liveOverlay.hidden = true;
  emptyState.hidden = false;
  emptyTitle.textContent = "Your stage is ready";
  stageMessage.textContent = "Camera is off. Start it whenever your play space is ready.";
  stageMessage.removeAttribute("data-error");
  videoSize.textContent = "Waiting for camera";
  frameRate.textContent = "—";
  cameraName.textContent = "—";
  resetRenderDiagnostics();
  setState("off", "Camera off");
  cameraButton.disabled = false;
  cameraButton.textContent = "Start camera";
}

function releaseStream(): void {
  session?.abort();
  session = null;
  removeTrackListener?.();
  removeTrackListener = null;
  renderer?.dispose();
  renderer = null;
  const stream = activeStream;
  activeStream = null;
  stream?.getTracks().forEach((track) => track.stop());
  video.pause();
  video.srcObject = null;
}

function showFailure(error: unknown, insecureContext = false, renderingError = false): void {
  const message = renderingError && error instanceof Error ? error.message : insecureContext
    ? getUnsupportedCameraMessage(false)
    : error instanceof Error && error.message === "Camera API unavailable"
      ? getUnsupportedCameraMessage(true)
      : getCameraErrorMessage(error);

  canvas.hidden = true;
  liveOverlay.hidden = true;
  emptyState.hidden = false;
  emptyTitle.textContent = renderingError ? "Stage unavailable" : "Camera unavailable";
  videoSize.textContent = "Waiting for camera";
  frameRate.textContent = "—";
  cameraName.textContent = "—";
  resetRenderDiagnostics();
  stageMessage.textContent = message;
  stageMessage.dataset.error = "true";
  setState("error", "Needs attention");
  cameraButton.disabled = false;
  cameraButton.textContent = "Try again";
}

function updateDiagnostics(track: MediaStreamTrack): void {
  videoSize.textContent = `${video.videoWidth} × ${video.videoHeight}`;
  const settings = track.getSettings();
  frameRate.textContent = typeof settings.frameRate === "number"
    ? `${Math.round(settings.frameRate)} fps`
    : "Unavailable";
  cameraName.textContent = track.label.trim() || "Camera name hidden by browser";
}

function updateRenderDiagnostics(stats: RenderDiagnostics | null): void {
  if (!stats) {
    renderRate.textContent = "Paused while hidden";
    frameTime.textContent = submissionTime.textContent = "—";
    return;
  }
  renderRate.textContent = `${stats.fps.toFixed(1)} fps / 30 target`;
  frameTime.textContent = `${stats.frameMs.toFixed(1)} ms`;
  submissionTime.textContent = `${stats.submissionMs.toFixed(2)} ms`;
  renderSize.textContent = `${stats.width} × ${stats.height}`;
  videoSize.textContent = `${stats.videoWidth} × ${stats.videoHeight}`;
  cameraView.textContent = stats.mirrored ? "Mirrored · fit whole frame" : "Unmirrored · fit whole frame";
}

function resetRenderDiagnostics(): void {
  renderRate.textContent = frameTime.textContent = submissionTime.textContent = renderSize.textContent = cameraView.textContent = "—";
}

function setState(state: "off" | "requesting" | "live" | "error", label: string): void {
  cameraState.dataset.state = state;
  cameraStateLabel.textContent = label;
}

function waitForMetadata(element: HTMLVideoElement, signal: AbortSignal): Promise<void> {
  if (element.readyState >= HTMLMediaElement.HAVE_METADATA && element.videoWidth > 0) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      element.removeEventListener("loadedmetadata", onLoaded);
      element.removeEventListener("error", onError);
      signal.removeEventListener("abort", onAbort);
    };
    const onLoaded = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); reject(new Error("The camera preview could not be loaded")); };
    const onAbort = () => { cleanup(); reject(new DOMException("Camera start cancelled", "AbortError")); };
    const timeout = window.setTimeout(onError, 10000);
    element.addEventListener("loadedmetadata", onLoaded);
    element.addEventListener("error", onError);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

// Release the camera and renderer on navigation, including entry to the back/forward cache.
window.addEventListener("pagehide", stopCamera);

function getBrowserName(): string {
  const userAgent = navigator.userAgent;
  const edgeVersion = userAgent.match(/Edg\/([\d.]+)/);
  if (edgeVersion) {
    return `Edge ${edgeVersion[1].split(".")[0]}`;
  }

  const match = userAgent.match(/(Edg|Chrome|CriOS|Firefox|FxiOS|Version|Safari)\/([\d.]+)/);
  if (!match) {
    return "Unknown browser";
  }

  const browser = match[1] === "Edg" ? "Edge"
    : match[1] === "Chrome" || match[1] === "CriOS" ? "Chrome"
      : match[1] === "Firefox" || match[1] === "FxiOS" ? "Firefox"
        : match[1] === "Version" || match[1] === "Safari" ? "Safari"
          : match[1];
  return `${browser} ${match[2].split(".")[0]}`;
}

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Required page element #${id} is missing`);
  }
  return element as T;
}
