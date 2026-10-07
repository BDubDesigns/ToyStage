import { getCameraRect, getRenderSize } from "./compositor-layout";
import { defaultChromaKeySettings, getSamplePoint, sampleVideoColor } from "./chroma-key";
import type { ChromaKeySettings, RGB } from "./chroma-key";
import { createProgram } from "./gl-program";
import { ForegroundSensor } from "./foreground-sensor";
import type { ForegroundMask } from "./foreground-mask";
import { CAMERA_FRAGMENT } from "./chroma-key-shader";
import { SCENE_FRAGMENT } from "./scene-shader";
import { getSceneUvScale } from "./scenes";
import type { Scene } from "./scenes";

export interface RenderDiagnostics {
  fps: number;
  frameMs: number;
  submissionMs: number;
  width: number;
  height: number;
  videoWidth: number;
  videoHeight: number;
  mirrored: boolean;
  maskWidth: number;
  maskHeight: number;
  sensingHz: number;
  sensingMs: number;
  readbackMs: number;
}

interface CompositorOptions {
  mirrored: boolean;
  onDiagnostics: (diagnostics: RenderDiagnostics | null) => void;
  onError: (error: Error) => void;
  onMask?: (mask: ForegroundMask) => void;
}

const FRAME_INTERVAL = 1000 / 30;

export class WebGLCompositor {
  private readonly gl: WebGL2RenderingContext;
  private readonly sensor: ForegroundSensor;
  private sensingEnabled = true;
  private samples = 0;
  private sensingTotal = 0;
  private readbackTotal = 0;
  private sensingFrameTime = -1;
  private background: WebGLProgram | null = null;
  private camera: WebGLProgram | null = null;
  private texture: WebGLTexture | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private sizeUniform: WebGLUniformLocation | null = null;
  private sceneTexture: WebGLTexture | null = null;
  private sceneUniforms: Record<string, WebGLUniformLocation | null> = {};
  private sceneImage: HTMLImageElement | null = null;
  private sceneDirty = false;
  private animatedScene = true;
  private sceneMotion = true;
  private sceneTime = 0;
  private lastAnimationFrame = 0;
  private rectUniform: WebGLUniformLocation | null = null;
  private keySettings = defaultChromaKeySettings();
  private keyUniforms: Record<string, WebGLUniformLocation | null> = {};
  private observer: ResizeObserver | null = null;
  private animationId: number | null = null;
  private running = false;
  private disposed = false;
  private lastScheduled = 0;
  private lastVideoTime = -1;
  private textureWidth = 0;
  private textureHeight = 0;
  private statsStart = 0;
  private previousFrame = 0;
  private frames = 0;
  private frameTotal = 0;
  private submissionTotal = 0;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly video: HTMLVideoElement, private readonly options: CompositorOptions) {
    const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error("WebGL 2 is unavailable. Try a recent browser with hardware acceleration enabled.");
    this.gl = gl;
    this.sensor = new ForegroundSensor(gl);
  }

  get foregroundMask(): ForegroundMask { return this.sensor.mask; }

  setSensingEnabled(enabled: boolean): void {
    if (enabled === this.sensingEnabled) return;
    this.sensingEnabled = enabled;
    this.resetSensing();
  }

  private resetSensing(): void {
    this.sensor.reset();
    this.sensingFrameTime = -1;
    this.samples = this.sensingTotal = this.readbackTotal = 0;
    this.options.onMask?.(this.sensor.mask);
  }

  setChromaKey(settings: ChromaKeySettings): void {
    const old = this.keySettings;
    if (old.enabled !== settings.enabled || old.tolerance !== settings.tolerance || old.softness !== settings.softness || old.color.some((value, i) => value !== settings.color[i])) this.resetSensing();
    this.keySettings = { ...settings, color: [...settings.color] };
  }

  setScene(scene: Scene, image: HTMLImageElement | null): void {
    this.animatedScene = scene.kind === "animated";
    this.sceneImage = image;
    this.sceneDirty = image !== null;
    this.sceneTime = 0;
  }

  setSceneMotion(enabled: boolean): void {
    this.sceneMotion = enabled;
  }

  sampleColor(x: number, y: number): RGB | null {
    if (!this.running || this.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return null;
    const point = getSamplePoint(x, y, this.canvas.width, this.canvas.height, this.video.videoWidth, this.video.videoHeight, this.options.mirrored);
    return point ? sampleVideoColor(this.video, point) : null;
  }

  start(): void {
    if (this.disposed) throw new Error("This compositor has been disposed.");
    if (this.running) return;
    if (this.gl.isContextLost()) throw new Error("The graphics context is recovering. Wait a moment, then try again.");
    try {
      this.createResources();
      this.running = true;
      this.canvas.addEventListener("webglcontextlost", this.onContextLost);
      document.addEventListener("visibilitychange", this.onVisibilityChange);
      this.observer = new ResizeObserver(this.resize);
      this.observer.observe(this.canvas);
      this.resize();
      this.resume();
    } catch (error) {
      this.stop();
      throw error;
    }
  }

  // Stop releases all GPU objects and listeners; start can allocate them again.
  stop(): void {
    this.running = false;
    this.cancelFrame();
    this.observer?.disconnect();
    this.observer = null;
    this.canvas.removeEventListener("webglcontextlost", this.onContextLost);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    const gl = this.gl;
    gl.bindVertexArray(null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.useProgram(null);
    this.sensor.stop();
    this.resetSensing();
    gl.deleteTexture(this.texture);
    gl.deleteTexture(this.sceneTexture);
    this.sceneTexture = null;
    this.sceneUniforms = {};
    gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.background);
    gl.deleteProgram(this.camera);
    this.texture = this.vao = this.background = this.camera = null;
    this.sizeUniform = this.rectUniform = null;
    this.keyUniforms = {};
    this.textureWidth = this.textureHeight = 0;
    this.lastVideoTime = -1;
    if (!gl.isContextLost()) {
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
  }

  dispose(): void {
    this.stop();
    this.disposed = true;
  }

  private createResources(): void {
    const gl = this.gl;
    this.background = createProgram(gl, SCENE_FRAGMENT);
    this.camera = createProgram(gl, CAMERA_FRAGMENT);
    this.texture = gl.createTexture();
    this.sceneTexture = gl.createTexture();
    this.vao = gl.createVertexArray();
    if (!this.texture || !this.sceneTexture || !this.vao) throw new Error("The graphics renderer could not allocate its resources.");
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // Keep the sampler complete even before a still has loaded.
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([5, 8, 22, 255]));
    this.sceneDirty = this.sceneImage !== null;
    this.sizeUniform = gl.getUniformLocation(this.background, "u_size");
    for (const name of ["scene", "uvScale", "animated", "time"]) {
      this.sceneUniforms[name] = gl.getUniformLocation(this.background, `u_${name}`);
    }
    gl.useProgram(this.background);
    gl.uniform1i(this.sceneUniforms.scene, 1);
    gl.activeTexture(gl.TEXTURE0);
    this.rectUniform = gl.getUniformLocation(this.camera, "u_rect");
    for (const name of ["keyEnabled", "keyColor", "tolerance", "softness", "despill", "showMask"]) {
      this.keyUniforms[name] = gl.getUniformLocation(this.camera, `u_${name}`);
    }
    gl.useProgram(this.camera);
    gl.uniform1i(gl.getUniformLocation(this.camera, "u_camera"), 0);
    gl.uniform1i(gl.getUniformLocation(this.camera, "u_mirrored"), this.options.mirrored ? 1 : 0);
    this.sensor.start();
  }

  private readonly resize = (): void => {
    const bounds = this.canvas.getBoundingClientRect();
    const size = getRenderSize(bounds.width, bounds.height, window.devicePixelRatio);
    if (this.canvas.width !== size.width || this.canvas.height !== size.height) {
      this.canvas.width = size.width;
      this.canvas.height = size.height;
      this.resetSensing();
    }
    this.gl.viewport(0, 0, size.width, size.height);
  };

  private resume(): void {
    this.lastScheduled = 0;
    this.lastAnimationFrame = 0;
    this.lastVideoTime = -1;
    this.statsStart = performance.now();
    this.previousFrame = 0;
    this.frames = this.frameTotal = this.submissionTotal = 0;
    this.resetSensing();
    if (this.running && !document.hidden && this.animationId === null) {
      this.animationId = requestAnimationFrame(this.tick);
    }
  }

  private cancelFrame(): void {
    if (this.animationId !== null) cancelAnimationFrame(this.animationId);
    this.animationId = null;
  }

  private readonly onVisibilityChange = (): void => {
    this.cancelFrame();
    if (document.hidden) {
      this.resetSensing();
      this.options.onDiagnostics(null);
    }
    else this.resume();
  };

  private readonly onContextLost = (event: Event): void => {
    event.preventDefault();
    this.stop();
    this.options.onError(new Error("The graphics context was lost. Start the camera again to rebuild the stage."));
  };

  private readonly tick = (now: number): void => {
    this.animationId = null;
    if (!this.running || document.hidden) return;
    if (this.lastAnimationFrame && this.animatedScene && this.sceneMotion) {
      this.sceneTime += Math.min(now - this.lastAnimationFrame, 100) / 1000;
    }
    this.lastAnimationFrame = now;
    const elapsed = now - this.lastScheduled;
    if (elapsed >= FRAME_INTERVAL - 0.5) {
      this.lastScheduled = now - (elapsed >= FRAME_INTERVAL ? elapsed % FRAME_INTERVAL : 0);
      try {
        if (this.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && this.video.videoWidth > 0 && this.video.videoHeight > 0) {
          const start = performance.now();
          this.draw(now);
          this.submissionTotal += performance.now() - start;
          if (this.previousFrame) this.frameTotal += now - this.previousFrame;
          this.previousFrame = now;
          this.frames++;
          if (now - this.statsStart >= 1000 && this.frames > 1) {
            const frameMs = this.frameTotal / (this.frames - 1);
            this.options.onDiagnostics({
              fps: 1000 / frameMs, frameMs, submissionMs: this.submissionTotal / this.frames,
              width: this.canvas.width, height: this.canvas.height,
              videoWidth: this.video.videoWidth, videoHeight: this.video.videoHeight,
              mirrored: this.options.mirrored,
              maskWidth: this.foregroundMask.width, maskHeight: this.foregroundMask.height,
              sensingHz: this.samples * 1000 / (now - this.statsStart),
              sensingMs: this.samples ? this.sensingTotal / this.samples : 0,
              readbackMs: this.samples ? this.readbackTotal / this.samples : 0,
            });
            this.statsStart = now;
            this.previousFrame = 0;
            this.frames = this.frameTotal = this.submissionTotal = 0;
            this.samples = this.sensingTotal = this.readbackTotal = 0;
          }
        }
      } catch (error) {
        this.stop();
        this.options.onError(error instanceof Error ? error : new Error("The graphics renderer stopped unexpectedly."));
        return;
      }
    }
    this.animationId = requestAnimationFrame(this.tick);
  };

  private draw(now: number): void {
    const gl = this.gl;
    const width = this.video.videoWidth;
    const height = this.video.videoHeight;
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    if (width !== this.textureWidth || height !== this.textureHeight) {
      this.resetSensing();
      // Upload directly from the DOM video source, with no CPU pixel readback.
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.video);
      this.textureWidth = width;
      this.textureHeight = height;
      this.lastVideoTime = this.video.currentTime;
    } else if (this.lastVideoTime !== this.video.currentTime) {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.video);
      this.lastVideoTime = this.video.currentTime;
    }
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTexture);
    if (this.sceneDirty && this.sceneImage) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.sceneImage);
      this.sceneDirty = false;
    }
    gl.disable(gl.BLEND);
    gl.useProgram(this.background);
    gl.uniform2f(this.sizeUniform, this.canvas.width, this.canvas.height);
    const uvScale = this.sceneImage ? getSceneUvScale(this.canvas.width, this.canvas.height, this.sceneImage.naturalWidth, this.sceneImage.naturalHeight) : [1, 1];
    gl.uniform2f(this.sceneUniforms.uvScale, uvScale[0], uvScale[1]);
    gl.uniform1i(this.sceneUniforms.animated, this.animatedScene ? 1 : 0);
    gl.uniform1f(this.sceneUniforms.time, this.sceneTime);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const rect = getCameraRect(this.canvas.width, this.canvas.height, width, height);
    gl.activeTexture(gl.TEXTURE0);
    gl.useProgram(this.camera);
    gl.uniform4f(this.rectUniform, rect.x, rect.y, rect.width, rect.height);
    const key = this.keySettings;
    gl.uniform1i(this.keyUniforms.keyEnabled, key.enabled ? 1 : 0);
    gl.uniform3f(this.keyUniforms.keyColor, ...key.color);
    gl.uniform1f(this.keyUniforms.tolerance, key.tolerance);
    gl.uniform1f(this.keyUniforms.softness, key.softness);
    gl.uniform1f(this.keyUniforms.despill, key.despill);
    gl.uniform1i(this.keyUniforms.showMask, key.showMask ? 1 : 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (this.sensingEnabled && this.sensingFrameTime !== this.lastVideoTime && this.sensor.sample(now, this.canvas.width, this.canvas.height, rect, key, this.options.mirrored)) {
      this.sensingFrameTime = this.lastVideoTime;
      this.samples++;
      this.sensingTotal += this.sensor.sampleMs;
      this.readbackTotal += this.sensor.readbackMs;
      this.options.onMask?.(this.foregroundMask);
    }
  }
}
