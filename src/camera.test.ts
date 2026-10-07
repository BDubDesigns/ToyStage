import { describe, expect, it } from "vitest";
import {
  CAMERA_CONSTRAINTS,
  cameraConstraints,
  chooseNextCamera,
  getCameraChoices,
  getCameraErrorMessage,
  getCameraFacingMode,
  getUnsupportedCameraMessage,
  isCameraApiAvailable,
  requestCamera,
  shouldMirrorPreview,
} from "./camera";

describe("camera acquisition", () => {
  it("prefers a 720p, 30 fps environment camera without requesting audio", async () => {
    const stream = {} as MediaStream;
    const getUserMedia = async () => stream;

    await expect(requestCamera({ getUserMedia })).resolves.toBe(stream);
    expect(CAMERA_CONSTRAINTS).toEqual({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30, max: 30 },
      },
    });
  });

  it("retries with basic video when a camera rejects preferred constraints", async () => {
    const stream = {} as MediaStream;
    const calls: MediaStreamConstraints[] = [];
    const getUserMedia = async (constraints: MediaStreamConstraints) => {
      calls.push(constraints);
      if (calls.length === 1) {
        throw new DOMException("Unsupported hint", "OverconstrainedError");
      }
      return stream;
    };

    await expect(requestCamera({ getUserMedia })).resolves.toBe(stream);
    expect(calls).toEqual([CAMERA_CONSTRAINTS, { audio: false, video: true }]);
  });

  it("targets the selected device and keeps that target during a constraint fallback", async () => {
    const stream = {} as MediaStream;
    const calls: MediaStreamConstraints[] = [];
    const getUserMedia = async (constraints: MediaStreamConstraints) => {
      calls.push(constraints);
      if (calls.length === 1) throw new DOMException("Unsupported hint", "OverconstrainedError");
      return stream;
    };
    await expect(requestCamera({ getUserMedia }, "front-id")).resolves.toBe(stream);
    expect(calls).toEqual([
      cameraConstraints("front-id"),
      { audio: false, video: { deviceId: { exact: "front-id" } } },
    ]);
  });

  it("detects when the browser exposes camera capture", () => {
    expect(isCameraApiAvailable({ getUserMedia: async () => ({} as MediaStream) })).toBe(true);
    expect(isCameraApiAvailable(undefined)).toBe(false);
  });
});

describe("camera discovery and selection", () => {
  const device = (deviceId: string, label: string, kind = "videoinput") => ({ deviceId, label, kind } as MediaDeviceInfo);

  it("lists only video inputs and gives unlabeled or generic devices stable session labels", () => {
    expect(getCameraChoices([
      device("mic", "Microphone", "audioinput"), device("a", ""), device("b", "Camera 2"), device("c", "Back lens"),
    ])).toEqual([
      { deviceId: "a", label: "Camera 1" },
      { deviceId: "b", label: "Camera 2" },
      { deviceId: "c", label: "Back lens", facingMode: "environment" },
    ]);
  });

  it("switches to the opposite facing camera when known and cycles devices otherwise", () => {
    const cameras = [
      { deviceId: "rear-wide", label: "Back wide", facingMode: "environment" },
      { deviceId: "front", label: "Front camera", facingMode: "user" },
      { deviceId: "rear-other", label: "Camera 3", facingMode: "environment" },
    ];
    expect(chooseNextCamera(cameras, "rear-wide", "environment")?.deviceId).toBe("front");
    expect(chooseNextCamera(cameras, "front", "user")?.deviceId).toBe("rear-wide");
    const generic = cameras.map(({ deviceId, label }) => ({ deviceId, label }));
    expect(chooseNextCamera(generic, "rear-wide")?.deviceId).toBe("front");
    expect(chooseNextCamera(generic, "rear-other")?.deviceId).toBe("rear-wide");
    expect(chooseNextCamera(generic.slice(0, 1), "rear-wide")).toBeNull();
  });

  it("uses facing labels when track settings do not report facingMode", () => {
    expect(getCameraFacingMode({ getSettings: () => ({}), label: "Front camera" })).toBe("user");
    expect(getCameraFacingMode({ getSettings: () => ({}), label: "USB Camera" })).toBeUndefined();
  });
});

describe("camera messaging", () => {
  it("explains how to recover from blocked permission", () => {
    expect(getCameraErrorMessage({ name: "NotAllowedError" })).toContain("Allow camera access");
  });

  it("explains when no camera is available", () => {
    expect(getCameraErrorMessage({ name: "NotFoundError" })).toContain("No camera was found");
  });

  it("explains a camera that cannot start", () => {
    expect(getCameraErrorMessage({ name: "NotReadableError" })).toContain("in use by another app");
  });

  it("provides a secure-context hint for unsupported camera access", () => {
    expect(getUnsupportedCameraMessage(false)).toContain("HTTPS or localhost");
  });
});

describe("preview orientation", () => {
  it("mirrors a user-facing camera", () => {
    expect(shouldMirrorPreview("user")).toBe(true);
  });

  it("leaves an environment-facing or unknown camera unmirrored", () => {
    expect(shouldMirrorPreview("environment")).toBe(false);
    expect(shouldMirrorPreview(undefined)).toBe(false);
  });
});
