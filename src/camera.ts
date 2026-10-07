export const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: { ideal: "environment" },
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 30, max: 30 },
  },
};

export function isCameraApiAvailable(mediaDevices: Pick<MediaDevices, "getUserMedia"> | undefined): mediaDevices is Pick<MediaDevices, "getUserMedia"> {
  return typeof mediaDevices?.getUserMedia === "function";
}

export async function requestCamera(mediaDevices: Pick<MediaDevices, "getUserMedia">): Promise<MediaStream> {
  try {
    return await mediaDevices.getUserMedia(CAMERA_CONSTRAINTS);
  } catch (error) {
    if (getErrorName(error) !== "OverconstrainedError") {
      throw error;
    }

    // Some cameras reject one of the preferred size/frame-rate hints. Retry with
    // the browser's simplest video request so that an optional hint won't block use.
    return mediaDevices.getUserMedia({ audio: false, video: true });
  }
}

export function shouldMirrorPreview(facingMode: string | undefined): boolean {
  return facingMode === "user";
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
