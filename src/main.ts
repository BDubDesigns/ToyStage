import "./styles.css";
import { SCENES, SceneImages } from "./scenes";
import type { Scene } from "./scenes";
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
import { colorFromHex, colorToHex, defaultChromaKeySettings } from "./chroma-key";

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

const scenePicker = getElement<HTMLElement>("scene-picker");
const sceneStatus = getElement<HTMLElement>("scene-status");
const sceneMotion = getElement<HTMLInputElement>("scene-motion");
sceneMotion.checked = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const sceneImages = new SceneImages();
// Cosmic Cruise is an asset-free fallback while the initial still loads.
let selectedScene = SCENES[4];
let selectedImage: HTMLImageElement | null = null;
let selectionVersion = 0;
const sceneButtons = new Map<string, HTMLButtonElement>();
for (const scene of SCENES) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "scene-card";
  button.setAttribute("aria-pressed", String(scene === selectedScene));
  const image = document.createElement("img");
  image.src = scene.thumbnail;
  image.alt = "";
  image.width = 160;
  image.height = 90;
  const label = document.createElement("span");
  label.textContent = scene.name;
  button.append(image, label);
  if (scene.kind === "animated") {
    const badge = document.createElement("small");
    badge.textContent = "Animated";
    button.append(badge);
  }
  button.addEventListener("click", () => { void selectScene(scene); });
  sceneButtons.set(scene.id, button);
  scenePicker.append(button);
}
function updateSceneButtons(scene: Scene): void {
  for (const [id, button] of sceneButtons) button.setAttribute("aria-pressed", String(id === scene.id));
}
async function selectScene(scene: Scene): Promise<void> {
  const version = ++selectionVersion;
  updateSceneButtons(scene);
  sceneStatus.textContent = `Loading ${scene.name}…`;
  sceneStatus.removeAttribute("data-error");
  try {
    const image = await sceneImages.load(scene);
    if (version !== selectionVersion) return;
    selectedScene = scene;
    selectedImage = image;
    renderer?.setScene(scene, image);
    sceneMotion.disabled = scene.kind !== "animated";
    canvas.setAttribute("aria-label", `Live keyed camera over ${scene.name}`);
    sceneStatus.textContent = scene.kind === "animated" ? `${scene.name} · watch for shooting stars and a visiting spaceship.` : `${scene.name} · ready for your toys.`;
  } catch (error) {
    if (version !== selectionVersion) return;
    updateSceneButtons(selectedScene);
    sceneMotion.disabled = selectedScene.kind !== "animated";
    canvas.setAttribute("aria-label", `Live keyed camera over ${selectedScene.name}`);
    sceneStatus.dataset.error = "true";
    sceneStatus.textContent = error instanceof Error ? error.message : "Scene unavailable. Try again.";
  }
}
sceneMotion.addEventListener("change", () => renderer?.setSceneMotion(sceneMotion.checked));
void selectScene(SCENES[0]);

const keyEnabled = getElement<HTMLInputElement>("key-enabled");
const keyColor = getElement<HTMLInputElement>("key-color");
const tolerance = getElement<HTMLInputElement>("key-tolerance");
const softness = getElement<HTMLInputElement>("key-softness");
const despill = getElement<HTMLInputElement>("key-despill");
const showMask = getElement<HTMLInputElement>("show-mask");
const sampleButton = getElement<HTMLButtonElement>("sample-color");
const calibrationStatus = getElement<HTMLElement>("calibration-status");
let keySettings = defaultChromaKeySettings();
let sampling = false;

function applyKeySettings(): void {
  renderer?.setChromaKey({ ...keySettings, enabled: keySettings.enabled && !sampling });
  for (const [input, output] of [[tolerance, "tolerance-value"], [softness, "softness-value"], [despill, "despill-value"]] as const) {
    getElement<HTMLOutputElement>(output).value = `${Math.round(Number(input.value) / Number(input.max) * 100)}%`;
  }
}

function setSampling(value: boolean): void {
  sampling = value;
  sampleButton.textContent = value ? "Cancel color pick" : "Pick blanket color";
  sampleButton.setAttribute("aria-pressed", String(value));
  canvas.classList.toggle("sampling", value);
  calibrationStatus.textContent = value ? "Original camera shown. Tap a clear patch of blanket in the preview. Escape cancels."
    : activeStream ? "Pick again whenever lighting changes. Adjust the sliders to keep toys visible."
      : "Start the camera to pick a color, or choose one with Screen color.";
  applyKeySettings();
}

for (const input of [keyEnabled, keyColor, tolerance, softness, despill, showMask]) {
  input.addEventListener("input", () => {
    keySettings = { enabled: keyEnabled.checked, color: colorFromHex(keyColor.value), tolerance: Number(tolerance.value), softness: Number(softness.value), despill: Number(despill.value), showMask: showMask.checked };
    if (input === keyColor && sampling) setSampling(false);
    else applyKeySettings();
  });
}
sampleButton.addEventListener("click", () => {
  setSampling(!sampling);
  if (sampling) canvas.scrollIntoView({ block: "center" });
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && sampling) setSampling(false);
});
canvas.addEventListener("click", (event) => {
  if (!sampling || !renderer) return;
  const bounds = canvas.getBoundingClientRect();
  try {
    const color = renderer.sampleColor((event.clientX - bounds.left) / bounds.width, (event.clientY - bounds.top) / bounds.height);
    if (!color) {
      calibrationStatus.textContent = "Tap inside the camera image, away from the scene border.";
      return;
    }
    keySettings.color = color;
    keyColor.value = colorToHex(color);
    setSampling(false);
    calibrationStatus.textContent = "Blanket color picked. Adjust Remove more blanket for shadows, then soften the edges.";
  } catch (error) {
    setSampling(false);
    calibrationStatus.textContent = error instanceof Error ? error.message : "Could not pick a color. Use Screen color instead.";
  }
});
getElement<HTMLButtonElement>("reset-key").addEventListener("click", () => {
  keySettings = defaultChromaKeySettings();
  keyEnabled.checked = keySettings.enabled;
  keyColor.value = colorToHex(keySettings.color);
  tolerance.value = String(keySettings.tolerance);
  softness.value = String(keySettings.softness);
  despill.value = String(keySettings.despill);
  showMask.checked = keySettings.showMask;
  setSampling(false);
});
applyKeySettings();

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
    if (selectedScene.kind === "animated" || selectedImage) renderer.setScene(selectedScene, selectedImage);
    renderer.setSceneMotion(sceneMotion.checked);
    renderer.start();
    applyKeySettings();
    sampleButton.disabled = false;
    setSampling(false);
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
  sampleButton.disabled = true;
  setSampling(false);
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
