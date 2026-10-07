import { getCameraRect, getRenderSize } from "./compositor-layout";

export interface RenderDiagnostics {
  fps: number;
  frameMs: number;
  submissionMs: number;
  width: number;
  height: number;
  videoWidth: number;
  videoHeight: number;
  mirrored: boolean;
}

interface CompositorOptions {
  mirrored: boolean;
  onDiagnostics: (diagnostics: RenderDiagnostics | null) => void;
  onError: (error: Error) => void;
}

const VERTEX = `#version 300 es
out vec2 v_uv;
void main() {
  // A fullscreen triangle, with no vertex buffer or per-frame geometry upload.
  vec2 uv = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  v_uv = uv;
  gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
}`;

const BACKGROUND = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform vec2 u_size;
out vec4 color;
void main() {
  vec2 cell = fract(v_uv * u_size / 48.0);
  float grid = max(step(0.97, cell.x), step(0.97, cell.y));
  vec3 base = mix(vec3(0.055, 0.09, 0.12), vec3(0.12, 0.22, 0.23), v_uv.y);
  color = vec4(mix(base, vec3(0.28, 0.38, 0.29), grid * 0.55), 1.0);
}`;

const CAMERA = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_camera;
uniform vec4 u_rect;
uniform bool u_mirrored;
out vec4 color;
void main() {
  vec2 uv = (v_uv - u_rect.xy) / u_rect.zw;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) discard;
  // DOM video rows start at the top. Upload without UNPACK_FLIP_Y_WEBGL,
  // then explicitly map stage-up to video-down and mirror only user cameras.
  uv.y = 1.0 - uv.y;
  if (u_mirrored) uv.x = 1.0 - uv.x;
  color = vec4(texture(u_camera, uv).rgb, 1.0);
}`;

const FRAME_INTERVAL = 1000 / 30;

export class WebGLCompositor {
  private readonly gl: WebGL2RenderingContext;
  private background: WebGLProgram | null = null;
  private camera: WebGLProgram | null = null;
  private texture: WebGLTexture | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private sizeUniform: WebGLUniformLocation | null = null;
  private rectUniform: WebGLUniformLocation | null = null;
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
    gl.deleteTexture(this.texture);
    gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.background);
    gl.deleteProgram(this.camera);
    this.texture = this.vao = this.background = this.camera = null;
    this.sizeUniform = this.rectUniform = null;
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
    this.background = createProgram(gl, BACKGROUND);
    this.camera = createProgram(gl, CAMERA);
    this.texture = gl.createTexture();
    this.vao = gl.createVertexArray();
    if (!this.texture || !this.vao) throw new Error("The graphics renderer could not allocate its resources.");
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    this.sizeUniform = gl.getUniformLocation(this.background, "u_size");
    this.rectUniform = gl.getUniformLocation(this.camera, "u_rect");
    gl.useProgram(this.camera);
    gl.uniform1i(gl.getUniformLocation(this.camera, "u_camera"), 0);
    gl.uniform1i(gl.getUniformLocation(this.camera, "u_mirrored"), this.options.mirrored ? 1 : 0);
  }

  private readonly resize = (): void => {
    const bounds = this.canvas.getBoundingClientRect();
    const size = getRenderSize(bounds.width, bounds.height, window.devicePixelRatio);
    if (this.canvas.width !== size.width || this.canvas.height !== size.height) {
      this.canvas.width = size.width;
      this.canvas.height = size.height;
    }
    this.gl.viewport(0, 0, size.width, size.height);
  };

  private resume(): void {
    this.lastScheduled = 0;
    this.lastVideoTime = -1;
    this.statsStart = performance.now();
    this.previousFrame = 0;
    this.frames = this.frameTotal = this.submissionTotal = 0;
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
    if (document.hidden) this.options.onDiagnostics(null);
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
    const elapsed = now - this.lastScheduled;
    if (elapsed >= FRAME_INTERVAL - 0.5) {
      this.lastScheduled = now - (elapsed >= FRAME_INTERVAL ? elapsed % FRAME_INTERVAL : 0);
      try {
        if (this.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && this.video.videoWidth > 0 && this.video.videoHeight > 0) {
          const start = performance.now();
          this.draw();
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
            });
            this.statsStart = now;
            this.previousFrame = 0;
            this.frames = this.frameTotal = this.submissionTotal = 0;
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

  private draw(): void {
    const gl = this.gl;
    const width = this.video.videoWidth;
    const height = this.video.videoHeight;
    gl.bindVertexArray(this.vao);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    if (width !== this.textureWidth || height !== this.textureHeight) {
      // Upload directly from the DOM video source, with no CPU pixel readback.
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.video);
      this.textureWidth = width;
      this.textureHeight = height;
      this.lastVideoTime = this.video.currentTime;
    } else if (this.lastVideoTime !== this.video.currentTime) {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.video);
      this.lastVideoTime = this.video.currentTime;
    }
    gl.useProgram(this.background);
    gl.uniform2f(this.sizeUniform, this.canvas.width, this.canvas.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const rect = getCameraRect(this.canvas.width, this.canvas.height, width, height);
    gl.useProgram(this.camera);
    gl.uniform4f(this.rectUniform, rect.x, rect.y, rect.width, rect.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

function createProgram(gl: WebGL2RenderingContext, fragmentSource: string): WebGLProgram {
  const shaders: WebGLShader[] = [];
  const attached: WebGLShader[] = [];
  const program = gl.createProgram();
  if (!program) throw new Error("The graphics renderer could not create a shader program.");
  try {
    for (const [type, source] of [[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER, fragmentSource]] as const) {
      const shader = gl.createShader(type);
      if (!shader) throw new Error("The graphics renderer could not create a shader.");
      shaders.push(shader);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(`Stage shader failed: ${gl.getShaderInfoLog(shader) ?? "unknown error"}`);
      }
      gl.attachShader(program, shader);
      attached.push(shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Stage program failed: ${gl.getProgramInfoLog(program) ?? "unknown error"}`);
    }
    return program;
  } catch (error) {
    gl.deleteProgram(program);
    throw error;
  } finally {
    for (const shader of shaders) {
      // Detach before deleting so linked programs don't retain shader objects.
      if (gl.isProgram(program) && attached.includes(shader)) gl.detachShader(program, shader);
      gl.deleteShader(shader);
    }
  }
}
