import "./styles.css";
import {
  getCameraErrorMessage,
  getUnsupportedCameraMessage,
  isCameraApiAvailable,
  requestCamera,
  shouldMirrorPreview,
  supportsWebGL2,
} from "./camera";

const cameraButton = getElement<HTMLButtonElement>("camera-button");
const cameraState = getElement<HTMLElement>("camera-state");
const cameraStateLabel = getElement<HTMLElement>("camera-state-label");
const video = getElement<HTMLVideoElement>("stage-video");
const emptyState = getElement<HTMLElement>("empty-state");
const emptyTitle = getElement<HTMLElement>("empty-title");
const stageMessage = getElement<HTMLElement>("stage-message");
const liveOverlay = getElement<HTMLElement>("live-overlay");
const videoSize = getElement<HTMLElement>("video-size");
const frameRate = getElement<HTMLElement>("frame-rate");
const cameraName = getElement<HTMLElement>("camera-name");

let activeStream: MediaStream | null = null;

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
  setState("requesting", "Requesting access");
  cameraButton.disabled = true;
  cameraButton.textContent = "Requesting…";
  emptyTitle.textContent = "Waiting for permission";
  stageMessage.textContent = "Allow camera access in your browser to show the live stage.";
  stageMessage.removeAttribute("data-error");

  if (!isCameraApiAvailable(navigator.mediaDevices)) {
    showFailure(new Error("Camera API unavailable"), !window.isSecureContext);
    return;
  }

  let stream: MediaStream | null = null;
  try {
    stream = await requestCamera(navigator.mediaDevices);
    const track = stream.getVideoTracks()[0];
    if (!track) {
      throw new Error("Camera stream did not include a video track");
    }

    activeStream = stream;
    video.srcObject = stream;
    await waitForMetadata(video);
    await video.play();

    video.classList.toggle("is-mirrored", shouldMirrorPreview(track.getSettings().facingMode));
    video.hidden = false;
    emptyState.hidden = true;
    liveOverlay.hidden = false;
    updateDiagnostics(track);
    setState("live", "Camera live");
    cameraButton.disabled = false;
    cameraButton.textContent = "Stop camera";

    track.addEventListener("ended", () => {
      if (activeStream !== stream) {
        return;
      }
      releaseStream();
      showFailure(new DOMException("Camera track ended", "NotReadableError"));
    }, { once: true });
  } catch (error) {
    stream?.getTracks().forEach((track) => track.stop());
    if (activeStream === stream) {
      activeStream = null;
    }
    video.pause();
    video.srcObject = null;
    showFailure(error);
  }
}

function stopCamera(): void {
  releaseStream();
  video.hidden = true;
  video.classList.remove("is-mirrored");
  liveOverlay.hidden = true;
  emptyState.hidden = false;
  emptyTitle.textContent = "Your stage is ready";
  stageMessage.textContent = "Camera is off. Start it whenever your play space is ready.";
  stageMessage.removeAttribute("data-error");
  videoSize.textContent = "Waiting for camera";
  frameRate.textContent = "—";
  cameraName.textContent = "—";
  setState("off", "Camera off");
  cameraButton.disabled = false;
  cameraButton.textContent = "Start camera";
}

function releaseStream(): void {
  const stream = activeStream;
  activeStream = null;
  stream?.getTracks().forEach((track) => track.stop());
  video.pause();
  video.srcObject = null;
}

function showFailure(error: unknown, insecureContext = false): void {
  const message = insecureContext
    ? getUnsupportedCameraMessage(false)
    : error instanceof Error && error.message === "Camera API unavailable"
      ? getUnsupportedCameraMessage(true)
      : getCameraErrorMessage(error);

  video.hidden = true;
  liveOverlay.hidden = true;
  emptyState.hidden = false;
  emptyTitle.textContent = "Camera unavailable";
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

function setState(state: "off" | "requesting" | "live" | "error", label: string): void {
  cameraState.dataset.state = state;
  cameraStateLabel.textContent = label;
}

function waitForMetadata(element: HTMLVideoElement): Promise<void> {
  if (element.readyState >= HTMLMediaElement.HAVE_METADATA && element.videoWidth > 0) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    element.addEventListener("loadedmetadata", () => resolve(), { once: true });
    element.addEventListener("error", () => reject(new Error("The camera preview could not be loaded")), { once: true });
  });
}

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
