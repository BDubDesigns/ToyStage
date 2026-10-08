import "./styles.css";
import { SCENES, SceneImages } from "./scenes";
import type { Scene } from "./scenes";
import {
  chooseNextCamera,
  getCameraChoices,
  getCameraErrorMessage,
  getCameraFacingMode,
  getUnsupportedCameraMessage,
  isCameraApiAvailable,
  requestCamera,
  shouldMirrorPreview,
  supportsWebGL2,
} from "./camera";
import type { CameraDeviceChoice } from "./camera";
import { WebGLCompositor } from "./compositor";
import type { RenderDiagnostics } from "./compositor";
import type { ForegroundMask } from "./foreground-mask";
import { colorFromHex, colorToHex, defaultChromaKeySettings } from "./chroma-key";
import { Ball } from "./ball";
import { BALL_PROFILES } from "./ball-profiles";
import { drawBall, drawBallAppearance } from "./ball-view";
import type { CameraRect } from "./compositor-layout";
import { PoseController } from "./pose/pose-controller";
import type { PoseStageDiagnostics } from "./pose/pose-controller";

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
const cameraSwitcher = getElement<HTMLElement>("camera-switcher");
const switchCameraButton = getElement<HTMLButtonElement>("switch-camera");
const cameraSelect = getElement<HTMLSelectElement>("camera-select");
const cameraSwitchStatus = getElement<HTMLElement>("camera-switch-status");

let activeStream: MediaStream | null = null;
let renderer: WebGLCompositor | null = null;
let session: AbortController | null = null;
let removeTrackListener: (() => void) | null = null;
let cameraChoices: CameraDeviceChoice[] = [];
let selectedCameraDeviceId: string | undefined;
let cameraSwitchInProgress = false;
let deviceChangeListener: (() => void) | null = null;
let mode: "green" | "pose" = "green";
let poseController: PoseController | null = null;
const poseCanvas = getElement<HTMLCanvasElement>("pose-canvas");
const posePrompt = getElement<HTMLElement>("pose-prompt");
const poseStatus = getElement<HTMLElement>("pose-status");
const poseRetry = getElement<HTMLButtonElement>("pose-retry");
const modeGreen = getElement<HTMLButtonElement>("mode-green");
const modePose = getElement<HTMLButtonElement>("mode-pose");

const ball = new Ball();
const ballEnabled = getElement<HTMLInputElement>("ball-enabled");
const ballDebug = getElement<HTMLInputElement>("ball-debug");
const ballOverlay = getElement<HTMLCanvasElement>("ball-overlay");
const ballStatus = getElement<HTMLElement>("ball-status");
const ballDiagnostics = getElement<HTMLElement>("ball-diagnostics");
const resetBall = getElement<HTMLButtonElement>("reset-ball");
const placeBall = getElement<HTMLButtonElement>("place-ball");
const ballPicker = getElement<HTMLElement>("ball-picker");
const ballHelp = getElement<HTMLElement>("ball-help");
let placingBall = false;
let lastBallDiagnostics = 0;

for (const profile of BALL_PROFILES) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ball-card";
  button.dataset.ballType = profile.id;
  button.setAttribute("aria-pressed", String(profile.id === ball.profile.id));
  button.setAttribute("aria-label", profile.label);
  const icon = document.createElement("canvas");
  icon.width = icon.height = 64;
  icon.setAttribute("aria-hidden", "true");
  const ctx = icon.getContext("2d");
  if (ctx) drawBallAppearance(ctx, profile, 32, 30, 23);
  const label = document.createElement("span");
  label.textContent = profile.label;
  const hint = document.createElement("small");
  hint.textContent = profile.hint;
  button.append(icon, label, hint);
  button.addEventListener("click", () => {
    ball.setType(profile.id);
    ballHelp.textContent = profile.description;
    for (const choice of ballPicker.querySelectorAll("button")) choice.setAttribute("aria-pressed", String(choice === button));
    setPlacingBall(false);
  });
  ballPicker.append(button);
}
ballHelp.textContent = ball.profile.description;

function setPlacingBall(value: boolean): void {
  placingBall = value;
  placeBall.setAttribute("aria-pressed", String(value));
  placeBall.textContent = value ? "Cancel placement" : "Place ball";
  canvas.classList.toggle("placing", value);
  updateBallControls();
}

function updateBallControls(): void {
  resetBall.disabled = placeBall.disabled = mode !== "green" || !activeStream || !ballEnabled.checked || sampling;
  const message = !activeStream ? "Start the camera to play." : !ballEnabled.checked ? "Ball is off. Turn on Play ball when you're ready."
    : sampling ? "Ball paused while you pick the blanket color."
    : placingBall ? "Tap inside the live camera area to place the ball. Escape cancels."
    : !keyEnabled.checked ? "Turn on Remove screen so the ball can sense your toys."
    : !sensingEnabled.checked ? "Turn on Sense foreground in Interaction check to play."
    : !ball.debug.fresh ? "Waiting for fresh camera input…"
    : "Nudge the ball with a toy or hand. Reset brings it back to the middle.";
  const status = `${ball.profile.label} · ${message}`;
  if (ballStatus.textContent !== status) ballStatus.textContent = status;
}

function updateBall(now: number, width: number, height: number, rect: CameraRect): void {
  if (!renderer || !ballEnabled.checked || sampling) { ballOverlay.hidden = true; ball.pause(); return; }
  ball.layout(width, height, rect);
  if (keyEnabled.checked && !placingBall) ball.tick(now, renderer.foregroundMask);
  else ball.pause();
  ballOverlay.hidden = false;
  drawBall(ballOverlay, ball, width, height, now, ballDebug.checked);
  updateBallControls();
  if (ballDebug.checked && now - lastBallDiagnostics >= 100) {
    lastBallDiagnostics = now;
    const d = ball.debug;
    const state = ball.profile.bounds === "contained" ? "No gravity" : ball.grounded ? "Grounded" : ball.aboveStage ? "Above stage" : "Airborne";
    ballDiagnostics.textContent = `${ball.profile.label} · ${state} · velocity (${ball.vx.toFixed(2)}, ${ball.vy.toFixed(2)}) /s · ${d.fresh ? d.contact ? "Contact" : "Clear" : "Paused"} · ${(d.coverage * 100).toFixed(0)}% overlap · ${(d.changed * 100).toFixed(0)}% changed · toy ${d.motion ? Math.hypot(d.motion.x, d.motion.y).toFixed(2) : "—"} /s · hit ${Math.hypot(d.impulse.x, d.impulse.y).toFixed(2)} · ${d.hits} hits`;
  }
}

ballEnabled.addEventListener("change", () => {
  ball.reset();
  ballOverlay.hidden = true;
  setPlacingBall(false);
});
ballDebug.addEventListener("change", () => {
  if (!ballDebug.checked) ballDiagnostics.textContent = "Show ball contact & motion to inspect hits.";
});
resetBall.addEventListener("click", () => { ball.reset(); setPlacingBall(false); });
placeBall.addEventListener("click", () => {
  setPlacingBall(!placingBall);
  if (placingBall) canvas.scrollIntoView({ block: "center" });
});

const sensingEnabled = getElement<HTMLInputElement>("sensing-enabled");
const sensingDebug = getElement<HTMLInputElement>("sensing-debug");
const sensingOverlay = getElement<HTMLCanvasElement>("sensing-overlay");
const sensingContext = sensingOverlay.getContext("2d");
const sensingRate = getElement<HTMLElement>("sensing-rate");
const sensingTime = getElement<HTMLElement>("sensing-time");
const sensingCoverage = getElement<HTMLElement>("sensing-coverage");
const sensingProbe = getElement<HTMLElement>("sensing-probe");
let maskImage: ImageData | null = null;

function updateMask(mask: ForegroundMask): void {
  sensingOverlay.hidden = !sensingDebug.checked || mask.timestamp === null;
  if (mask.timestamp === null) {
    ball.pause();
    ballOverlay.hidden = true;
    if (ballDebug.checked) ballDiagnostics.textContent = `${ball.profile.label} · Paused · ${ball.debug.hits} hits`;
    sensingContext?.clearRect(0, 0, sensingOverlay.width, sensingOverlay.height);
    maskImage = null;
    sensingCoverage.textContent = "—";
    sensingProbe.textContent = "Show the mask, then tap a toy or empty blanket.";
    return;
  }
  // Hidden debug UI does no pixel copying or coverage scans.
  if (!sensingDebug.checked) return;
  sensingCoverage.textContent = `${(mask.coverage({ x: 0, y: 0, width: 1, height: 1 }) * 100).toFixed(1)}% solid / ${(mask.motion().changed * 100).toFixed(1)}% changed`;
  if (!sensingContext) return;
  if (!maskImage || maskImage.width !== mask.width || maskImage.height !== mask.height) {
    sensingOverlay.width = mask.width;
    sensingOverlay.height = mask.height;
    maskImage = sensingContext.createImageData(mask.width, mask.height);
  }
  const pixels = mask.pixels();
  for (let i = 0; i < pixels.length; i++) {
    maskImage.data[i * 4] = 40;
    maskImage.data[i * 4 + 1] = 230;
    maskImage.data[i * 4 + 2] = 255;
    maskImage.data[i * 4 + 3] = pixels[i] ? 155 : 0;
  }
  sensingContext.putImageData(maskImage, 0, 0);
}

sensingEnabled.addEventListener("change", () => {
  renderer?.setSensingEnabled(sensingEnabled.checked && !sampling);
  sensingRate.textContent = sensingEnabled.checked ? "Waiting for mask" : "Off";
  sensingTime.textContent = "—";
});
sensingDebug.addEventListener("change", () => {
  sensingOverlay.hidden = true;
  if (!sensingDebug.checked) sensingCoverage.textContent = "—";
  if (renderer) updateMask(renderer.foregroundMask);
});

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
  updateBallControls();
}

function setSampling(value: boolean): void {
  sampling = value;
  if (value) setPlacingBall(false);
  renderer?.setSensingEnabled(sensingEnabled.checked && !sampling);
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
  if (event.key === "Escape" && placingBall) setPlacingBall(false);
});
canvas.addEventListener("click", (event) => {
  if (!sampling && placingBall) {
    const bounds = canvas.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width, y = (event.clientY - bounds.top) / bounds.height;
    const b = ball.bounds;
    if (x < b.x || x > b.x + b.width || y < b.y || y > b.y + b.height) return;
    ball.reset(x, y);
    setPlacingBall(false);
    return;
  }
  if (!sampling && sensingDebug.checked && renderer && renderer.foregroundMask.timestamp !== null) {
    const bounds = canvas.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width;
    const y = (event.clientY - bounds.top) / bounds.height;
    const mask = renderer.foregroundMask;
    const coverage = mask.coverage({ x: x - 0.03, y: y - 0.03, width: 0.06, height: 0.06 });
    sensingProbe.textContent = `${mask.occupied(x, y) ? "Solid" : "Empty"} at (${x.toFixed(2)}, ${y.toFixed(2)}) · ${(coverage * 100).toFixed(0)}% nearby coverage.`;
  }
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

switchCameraButton.addEventListener("click", () => {
  const track = activeStream?.getVideoTracks()[0];
  const choice = chooseNextCamera(cameraChoices, selectedCameraDeviceId, track ? getCameraFacingMode(track) : undefined);
  if (choice) void switchCamera(choice.deviceId);
});
cameraSelect.addEventListener("change", () => {
  const deviceId = cameraSelect.value;
  if (deviceId && deviceId !== selectedCameraDeviceId) void switchCamera(deviceId);
});

if (navigator.mediaDevices?.addEventListener) {
  const onDeviceChange = () => { void refreshCameraChoices(); };
  navigator.mediaDevices.addEventListener("devicechange", onDeviceChange);
  deviceChangeListener = () => navigator.mediaDevices.removeEventListener("devicechange", onDeviceChange);
}

async function startCamera(): Promise<void> {
  if (!isCameraApiAvailable(navigator.mediaDevices)) {
    releaseStream();
    showFailure(new Error("Camera API unavailable"), !window.isSecureContext);
    return;
  }
  const attempt = beginCameraRequest("Requesting access", "Waiting for permission", "Allow camera access in your browser to show the live stage.");
  let stream: MediaStream | null = null;
  let renderingError = false;
  try {
    if (mode === "green" && !webglAvailable) {
      throw new Error("WebGL 2 is unavailable. Try a recent browser with hardware acceleration enabled.");
    }
    stream = await requestCamera(navigator.mediaDevices);
    if (attempt.signal.aborted) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    renderingError = true;
    await attachCameraStream(stream, attempt);
  } catch (error) {
    if (stream && activeStream !== stream) stream.getTracks().forEach((track) => track.stop());
    if (attempt.signal.aborted) return;
    releaseStream();
    showFailure(error, false, renderingError || (mode === "green" && !webglAvailable));
  }
}

function beginCameraRequest(label: string, title: string, message: string): AbortController {
  const attempt = new AbortController();
  session = attempt;
  setState("requesting", label);
  cameraButton.disabled = true;
  cameraButton.textContent = "Requesting…";
  switchCameraButton.disabled = cameraSelect.disabled = true;
  emptyTitle.textContent = title;
  stageMessage.textContent = message;
  stageMessage.removeAttribute("data-error");
  return attempt;
}

async function attachCameraStream(stream: MediaStream, attempt: AbortController, requestedDeviceId?: string): Promise<void> {
  const track = stream.getVideoTracks()[0];
  if (!track) throw new Error("Camera stream did not include a video track");
  activeStream = stream;
  selectedCameraDeviceId = track.getSettings().deviceId || requestedDeviceId || cameraChoices.find((choice) => choice.label === track.label.trim())?.deviceId;
  video.srcObject = stream;
  await waitForMetadata(video, attempt.signal);
  await video.play();
  if (attempt.signal.aborted) return;
  if (track.readyState !== "live") throw new DOMException("Camera track ended while starting", "NotReadableError");

  startActiveStage(track);
  emptyState.hidden = true;
  liveOverlay.hidden = false;
  updateDiagnostics(track);
  setState("live", "Camera live");
  cameraButton.disabled = false;
  cameraButton.textContent = "Stop camera";
  cameraSwitchStatus.textContent = "";
  const onEnded = () => {
    if (activeStream !== stream) return;
    releaseStream();
    showFailure(new DOMException("Camera track ended", "NotReadableError"));
  };
  track.addEventListener("ended", onEnded, { once: true });
  removeTrackListener = () => track.removeEventListener("ended", onEnded);
  await refreshCameraChoices();
}

function stopActiveStage(): void {
  renderer?.dispose(); renderer = null;
  poseController?.dispose(); poseController = null;
  canvas.hidden = poseCanvas.hidden = posePrompt.hidden = true;
  sensingOverlay.hidden = ballOverlay.hidden = true;
  ball.pause();
  poseRetry.hidden = true;
}

function startActiveStage(track: MediaStreamTrack): void {
  stopActiveStage();
  resetRenderDiagnostics();
  if (mode === "pose") {
    poseCanvas.hidden = false;
    poseController = new PoseController(poseCanvas, video, shouldMirrorPreview(getCameraFacingMode(track)), updatePoseDiagnostics);
    poseController.start();
    sampleButton.disabled = true;
    return;
  }
  const stageRenderer = new WebGLCompositor(canvas, video, {
    mirrored: shouldMirrorPreview(getCameraFacingMode(track)),
    onDiagnostics: updateRenderDiagnostics,
    onMask: updateMask,
    onFrame: updateBall,
    onError: (error) => {
      if (renderer !== stageRenderer || mode !== "green") return;
      releaseStream();
      showFailure(error, false, true);
    },
  });
  renderer = stageRenderer;
  if (selectedScene.kind === "animated" || selectedImage) renderer.setScene(selectedScene, selectedImage);
  renderer.setSceneMotion(sceneMotion.checked);
  renderer.setSensingEnabled(sensingEnabled.checked);
  ball.reset();
  renderer.start();
  applyKeySettings();
  sampleButton.disabled = false;
  setSampling(false);
  canvas.hidden = false;
}

function selectMode(next: "green" | "pose"): void {
  if (mode === next) return;
  setSampling(false); setPlacingBall(false);
  mode = next;
  modeGreen.setAttribute("aria-pressed", String(mode === "green"));
  modePose.setAttribute("aria-pressed", String(mode === "pose"));
  getElement<HTMLElement>("stage-frame").dataset.mode = mode;
  getElement<HTMLElement>("stage-heading").textContent = mode === "pose" ? "Your moving double" : "Live stage";
  getElement<HTMLElement>("mode-help").textContent = mode === "pose" ? "Move your body. Your digital figure follows, with no camera image on screen." : "A green blanket turns your toys into part of the scene.";
  getElement<HTMLElement>("live-label").textContent = mode === "pose" ? "POSE STAGE" : "LIVE PREVIEW";
  getElement<HTMLElement>("stage-caption").textContent = mode === "pose" ? "One person at a time. Give yourself space, good light, and a full-body view." : "Pick a world, then remove the blanket to put your toys inside it. You can switch worlds while the camera stays live.";
  for (const panel of document.querySelectorAll<HTMLElement>("[data-green-screen]")) panel.hidden = mode === "pose";
  getElement<HTMLElement>("pose-panel").hidden = getElement<HTMLElement>("pose-diagnostics").hidden = mode !== "pose";
  updateBallControls();
  const track = activeStream?.getVideoTracks()[0];
  if (track && cameraState.dataset.state === "live") {
    try { startActiveStage(track); }
    catch (error) { releaseStream(); showFailure(error, false, true); }
  } else if (!session) {
    stopActiveStage();
    emptyTitle.textContent = "Your stage is ready";
    stageMessage.textContent = mode === "pose" ? "Start the camera, then step back so it sees your whole body." : "Start the camera to bring your play space into ToyStage.";
    stageMessage.removeAttribute("data-error");
    setState("off", "Camera off");
    cameraButton.textContent = "Start camera";
  }
}

modeGreen.addEventListener("click", () => selectMode("green"));
modePose.addEventListener("click", () => selectMode("pose"));
poseRetry.addEventListener("click", () => {
  const track = activeStream?.getVideoTracks()[0];
  if (mode === "pose" && track) {
    try { startActiveStage(track); }
    catch (error) { releaseStream(); showFailure(error, false, true); }
  }
});

function updatePoseDiagnostics(stats: PoseStageDiagnostics): void {
  if (mode !== "pose") return;
  const frame = stats.frame;
  const usable = frame?.poses.find((pose) => pose.state !== "unusable");
  const failed = stats.state === "error" || stats.state === "unsupported";
  const message = document.hidden ? "Pose paused while this tab is hidden." : failed
    ? `Pose Mode needs attention. ${stats.error}` : stats.state === "loading"
    ? "Getting your moving double ready… The first load may take a moment."
    : !usable ? "Step back so your body is in view. Good light helps!"
    : usable.state === "partial" ? "I can see part of you. Step back to bring your hands and feet into view."
    : "You're in view. Try a reach, a lean, or a squat!";
  if (poseStatus.textContent !== message) poseStatus.textContent = message;
  poseStatus.dataset.error = String(failed);
  posePrompt.hidden = Boolean(usable) && !failed || document.hidden;
  if (!posePrompt.hidden && posePrompt.textContent !== message) posePrompt.textContent = message;
  poseRetry.hidden = !failed;
  getElement<HTMLElement>("pose-worker-state").textContent = `${document.hidden ? "Paused" : stats.state} · Lite v1 / CPU worker`;
  getElement<HTMLElement>("pose-count").textContent = `${usable ? 1 : 0} / 1 · ${usable?.state ?? "looking for you"}`;
  getElement<HTMLElement>("pose-sample-rate").textContent = `${stats.sampleWidth} × ${stats.sampleHeight} / ${stats.samplesHz.toFixed(1)} Hz (18 target)`;
  getElement<HTMLElement>("pose-inference-time").textContent = `${stats.inferenceMs.toFixed(1)} ms`;
  getElement<HTMLElement>("pose-capture-time").textContent = `${stats.captureMs.toFixed(1)} / ${stats.roundTripMs.toFixed(1)} ms`;
  getElement<HTMLElement>("pose-age").textContent = frame ? `${Math.max(0, performance.now() - frame.capturedAt).toFixed(0)} ms · fresh` : "No fresh pose";
  getElement<HTMLElement>("pose-backpressure").textContent = `${stats.busy ? "One frame in flight" : "Ready for next frame"} · ${stats.skipped} skipped`;
  renderRate.textContent = document.hidden ? "Paused while hidden" : `${stats.fps.toFixed(1)} fps / 30 target · Pose`;
  frameTime.textContent = `${stats.frameMs.toFixed(1)} ms`;
  submissionTime.textContent = `${stats.drawMs.toFixed(2)} ms · Canvas draw`;
  renderSize.textContent = `${stats.width} × ${stats.height}`;
  videoSize.textContent = `${stats.videoWidth} × ${stats.videoHeight}`;
  cameraView.textContent = stats.mirrored ? "Mirrored · fit whole frame" : "Unmirrored · fit whole frame";
  sensingRate.textContent = "Off in Pose Mode";
}

async function switchCamera(deviceId: string): Promise<void> {
  if (!activeStream || cameraSwitchInProgress || !navigator.mediaDevices?.getUserMedia) return;
  const oldDeviceId = getActiveCameraDeviceId();
  if (!oldDeviceId || oldDeviceId === deviceId) return;
  cameraSwitchInProgress = true;
  switchCameraButton.disabled = cameraSelect.disabled = true;
  cameraSwitchStatus.textContent = "Switching camera…";
  cameraSwitchStatus.removeAttribute("data-error");
  setSampling(false);
  setPlacingBall(false);
  releaseStream();
  cameraSwitchStatus.textContent = "Switching camera…";
  const attempt = beginCameraRequest("Switching camera", "Switching camera", "Starting the selected camera. Your scene and screen settings are staying in place.");
  let targetStream: MediaStream | null = null;
  try {
    targetStream = await requestCamera(navigator.mediaDevices, deviceId);
    if (attempt.signal.aborted) { targetStream.getTracks().forEach((track) => track.stop()); return; }
    await attachCameraStream(targetStream, attempt, deviceId);
    if (attempt.signal.aborted) return;
    cameraSwitchStatus.textContent = mode === "pose" ? "Camera changed. Step into view again." : "Camera changed. Check the screen color; this camera may need its own calibration.";
  } catch (error) {
    if (targetStream && activeStream !== targetStream) targetStream.getTracks().forEach((track) => track.stop());
    if (attempt.signal.aborted) return;
    releaseStream();
    let recoveryAttempt: AbortController | null = null;
    try {
      recoveryAttempt = beginCameraRequest("Restoring camera", "Restoring previous camera", "The selected camera could not start. Reconnecting to the previous camera.");
      const recovered = await requestCamera(navigator.mediaDevices, oldDeviceId);
      if (recoveryAttempt.signal.aborted) { recovered.getTracks().forEach((track) => track.stop()); return; }
      await attachCameraStream(recovered, recoveryAttempt, oldDeviceId);
      if (recoveryAttempt.signal.aborted) return;
      const failedLabel = cameraChoices.find((camera) => camera.deviceId === deviceId)?.label ?? "selected camera";
      cameraSwitchStatus.dataset.error = "true";
      cameraSwitchStatus.textContent = `Could not switch to ${failedLabel}. Your previous camera is back. ${getCameraErrorMessage(error)}`;
    } catch {
      if (recoveryAttempt?.signal.aborted) return;
      releaseStream();
      showFailure(error);
      stageMessage.textContent = `Camera switch failed and the previous camera could not be restored. ${getCameraErrorMessage(error)} Use Try again to restart.`;
    }
  } finally {
    cameraSwitchInProgress = false;
    if (activeStream) switchCameraButton.disabled = cameraSelect.disabled = cameraChoices.length < 2;
  }
}

async function refreshCameraChoices(): Promise<void> {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  const currentSession = session;
  const currentStream = activeStream;
  try {
    const choices = getCameraChoices(await navigator.mediaDevices.enumerateDevices());
    if (session !== currentSession || activeStream !== currentStream) return;
    cameraChoices = choices;
    const currentId = getActiveCameraDeviceId();
    if (currentId) selectedCameraDeviceId = currentId;
    cameraSelect.replaceChildren();
    for (const choice of choices) {
      const option = document.createElement("option");
      option.value = choice.deviceId;
      option.textContent = `${choice.label}${choice.deviceId === currentId ? " · current" : ""}`;
      cameraSelect.append(option);
    }
    if (currentId && !choices.some((choice) => choice.deviceId === currentId)) {
      const current = document.createElement("option");
      current.value = currentId;
      current.textContent = `${activeStream?.getVideoTracks()[0]?.label.trim() || "Current camera"} · current`;
      cameraSelect.prepend(current);
    }
    if (currentId) cameraSelect.value = currentId;
    cameraSwitcher.hidden = choices.length < 2 || !activeStream;
    switchCameraButton.disabled = cameraSelect.disabled = choices.length < 2 || cameraSwitchInProgress || !activeStream;
  } catch {
    if (session !== currentSession || activeStream !== currentStream) return;
    // Some browsers do not allow enumeration until permission is granted; the
    // live stream remains usable and a later devicechange can refresh the list.
    cameraChoices = [];
    cameraSwitcher.hidden = true;
  }
}

function getActiveCameraDeviceId(): string | undefined {
  const track = activeStream?.getVideoTracks()[0];
  return track?.getSettings().deviceId || selectedCameraDeviceId
    || cameraChoices.find((choice) => choice.label === track?.label.trim())?.deviceId;
}

function stopCamera(): void {
  releaseStream();
  cameraSwitcher.hidden = true;
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
  stopActiveStage();
  const stream = activeStream;
  activeStream = null;
  selectedCameraDeviceId = undefined;
  ball.reset();
  ballOverlay.hidden = true;
  setPlacingBall(false);
  sampleButton.disabled = true;
  setSampling(false);
  stream?.getTracks().forEach((track) => track.stop());
  video.pause();
  video.srcObject = null;
  videoSize.textContent = "Waiting for camera";
  frameRate.textContent = cameraName.textContent = "—";
  resetRenderDiagnostics();
  cameraSwitcher.hidden = true;
  cameraSwitchStatus.textContent = "";
  poseStatus.textContent = "Start the camera when you have room to move.";
  getElement<HTMLElement>("pose-worker-state").textContent = "Off · Lite / CPU";
  for (const id of ["pose-count", "pose-sample-rate", "pose-inference-time", "pose-capture-time", "pose-age", "pose-backpressure"]) getElement<HTMLElement>(id).textContent = "—";
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
  cameraSwitcher.hidden = true;
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
  cameraView.textContent = shouldMirrorPreview(getCameraFacingMode(track)) ? "Mirrored · fit whole frame" : "Unmirrored · fit whole frame";
}

function updateRenderDiagnostics(stats: RenderDiagnostics | null): void {
  if (!stats) {
    renderRate.textContent = "Paused while hidden";
    frameTime.textContent = submissionTime.textContent = "—";
    sensingRate.textContent = "Paused while hidden";
    sensingTime.textContent = "—";
    return;
  }
  renderRate.textContent = `${stats.fps.toFixed(1)} fps / 30 target`;
  frameTime.textContent = `${stats.frameMs.toFixed(1)} ms`;
  submissionTime.textContent = `${stats.submissionMs.toFixed(2)} ms`;
  renderSize.textContent = `${stats.width} × ${stats.height}`;
  videoSize.textContent = `${stats.videoWidth} × ${stats.videoHeight}`;
  cameraView.textContent = stats.mirrored ? "Mirrored · fit whole frame" : "Unmirrored · fit whole frame";
  sensingRate.textContent = sampling ? "Paused for color pick" : !sensingEnabled.checked ? "Off" : `${stats.maskWidth} × ${stats.maskHeight} / ${stats.sensingHz.toFixed(1)} Hz`;
  sensingTime.textContent = sensingEnabled.checked && !sampling ? `${stats.sensingMs.toFixed(2)} ms / ${stats.readbackMs.toFixed(2)} ms` : "—";
}

function resetRenderDiagnostics(): void {
  renderRate.textContent = frameTime.textContent = submissionTime.textContent = renderSize.textContent = cameraView.textContent = "—";
  sensingRate.textContent = sensingTime.textContent = sensingCoverage.textContent = "—";
  sensingOverlay.hidden = true;
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
window.addEventListener("pagehide", () => {
  stopCamera();
  deviceChangeListener?.();
  deviceChangeListener = null;
});

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
