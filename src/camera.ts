export const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: { ideal: "environment" },
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 30, max: 30 },
  },
};

export interface CameraDeviceChoice {
  deviceId: string;
  label: string;
  facingMode?: string;
}

export function cameraConstraints(deviceId?: string): MediaStreamConstraints {
  if (!deviceId) return CAMERA_CONSTRAINTS;
  return {
    audio: false,
    video: {
      deviceId: { exact: deviceId },
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30, max: 30 },
    },
  };
}

export function getCameraChoices(devices: readonly MediaDeviceInfo[]): CameraDeviceChoice[] {
  const cameras = devices.filter((device) => device.kind === "videoinput" && device.deviceId);
  return cameras.map((device, index) => {
    const label = device.label.trim();
    const inferredFacing = facingFromLabel(label);
    return {
      deviceId: device.deviceId,
      label: label && !/^camera\s*\d*$/i.test(label) ? label : `Camera ${index + 1}`,
      ...(inferredFacing ? { facingMode: inferredFacing } : {}),
    };
  });
}

export function chooseNextCamera(
  cameras: readonly CameraDeviceChoice[],
  currentDeviceId: string | undefined,
  currentFacingMode?: string,
): CameraDeviceChoice | null {
  if (cameras.length < 2) return null;
  const currentIndex = cameras.findIndex((camera) => camera.deviceId === currentDeviceId);
  const facing = currentFacingMode || cameras[currentIndex]?.facingMode;
  const opposite = facing === "user" ? "environment" : facing === "environment" ? "user" : undefined;
  if (opposite) {
    const otherFacing = cameras.find((camera) => camera.deviceId !== currentDeviceId && camera.facingMode === opposite);
    if (otherFacing) return otherFacing;
  }
  return cameras[(currentIndex + 1 + cameras.length) % cameras.length] ?? cameras[0];
}

export function getCameraFacingMode(track: Pick<MediaStreamTrack, "getSettings" | "label">): string | undefined {
  const reported = track.getSettings().facingMode;
  return reported || facingFromLabel(track.label);
}

export function isCameraApiAvailable(mediaDevices: Pick<MediaDevices, "getUserMedia"> | undefined): mediaDevices is Pick<MediaDevices, "getUserMedia"> {
  return typeof mediaDevices?.getUserMedia === "function";
}

export async function requestCamera(mediaDevices: Pick<MediaDevices, "getUserMedia">, deviceId?: string): Promise<MediaStream> {
  const constraints = cameraConstraints(deviceId);
  try {
    return await mediaDevices.getUserMedia(constraints);
  } catch (error) {
    if (getErrorName(error) !== "OverconstrainedError") {
      throw error;
    }

    // Some cameras reject one of the preferred size/frame-rate hints. Retry with
    // the browser's simplest video request so that an optional hint won't block use.
    return mediaDevices.getUserMedia(deviceId
      ? { audio: false, video: { deviceId: { exact: deviceId } } }
      : { audio: false, video: true });
  }
}

export function shouldMirrorPreview(facingMode: string | undefined): boolean {
  return facingMode === "user";
}

function facingFromLabel(label: string): string | undefined {
  if (/\b(front|front-facing|user|selfie)\b/i.test(label)) return "user";
  if (/\b(rear|back|environment|world)\b/i.test(label)) return "environment";
  return undefined;
}

export function getCameraErrorMessage(error: unknown): string {
  switch (getErrorName(error)) {
    case "NotAllowedError":
    case "SecurityError":
      return "Camera permission was blocked. Allow camera access for this site in your browser settings, then try again.";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "No camera was found. Connect a camera and try again.";
    case "NotReadableError":
    case "TrackStartError":
      return "The camera could not start. It may be in use by another app; close that app and try again.";
    case "OverconstrainedError":
      return "This camera could not meet the requested video settings. Try another camera or browser.";
    case "AbortError":
      return "The camera stopped before it could start. Check the connection and try again.";
    default:
      return "ToyStage could not start the camera. Check your browser permission and camera connection, then try again.";
  }
}

export function getUnsupportedCameraMessage(isSecureContext: boolean): string {
  if (!isSecureContext) {
    return "Camera access needs a secure connection. Open ToyStage on HTTPS or localhost, then try again.";
  }
  return "This browser does not support camera access. Try a recent version of Chrome, Safari, or Firefox.";
}

export function supportsWebGL2(): boolean {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("webgl2");
  if (!context) {
    return false;
  }

  // Release the capability probe immediately so the future compositor owns the
  // only long-lived WebGL context.
  context.getExtension("WEBGL_lose_context")?.loseContext();
  return true;
}

function getErrorName(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("name" in error)) {
    return undefined;
  }
  return typeof error.name === "string" ? error.name : undefined;
}
