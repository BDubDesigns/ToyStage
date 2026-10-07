import { describe, expect, it } from "vitest";
import {
  CAMERA_CONSTRAINTS,
  getCameraErrorMessage,
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

  it("detects when the browser exposes camera capture", () => {
    expect(isCameraApiAvailable({ getUserMedia: async () => ({} as MediaStream) })).toBe(true);
    expect(isCameraApiAvailable(undefined)).toBe(false);
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
