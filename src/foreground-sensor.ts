import { KEY_GLSL } from "./chroma-key-shader";
import type { ChromaKeySettings } from "./chroma-key";
import type { CameraRect } from "./compositor-layout";
import { ForegroundMask, getMaskSize } from "./foreground-mask";
import { createProgram } from "./gl-program";

const MASK_FRAGMENT = `#version 300 es
precision highp float;
${KEY_GLSL}
out vec4 color;
void main() {
  float alpha = foregroundAlpha(texture(u_camera, cameraUv()).rgb);
  color = vec4(vec3(alpha), 1.0);
}`;

export class ForegroundSensor {
  readonly mask = new ForegroundMask();
  readbackMs = 0;
  sampleMs = 0;
  private program: WebGLProgram | null = null;
  private framebuffer: WebGLFramebuffer | null = null;
  private texture: WebGLTexture | null = null;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private rgba = new Uint8Array(0);
  private width = 0;
  private height = 0;
  private lastSample = -Infinity;

  constructor(private readonly gl: WebGL2RenderingContext) {}

  start(): void {
    const gl = this.gl;
    this.program = createProgram(gl, MASK_FRAGMENT);
    this.framebuffer = gl.createFramebuffer();
    this.texture = gl.createTexture();
    if (!this.texture || !this.framebuffer) throw new Error("Could not allocate the interaction mask.");
    for (const name of ["camera", "rect", "mirrored", "keyEnabled", "keyColor", "tolerance", "softness"]) {
      this.uniforms[name] = gl.getUniformLocation(this.program, `u_${name}`);
    }
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.activeTexture(gl.TEXTURE0);
  }

  reset(): void {
    this.mask.reset();
    this.lastSample = -Infinity;
    this.readbackMs = this.sampleMs = 0;
  }

  stop(): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteTexture(this.texture);
    gl.deleteFramebuffer(this.framebuffer);
    gl.deleteProgram(this.program);
    this.texture = this.framebuffer = this.program = null;
    this.uniforms = {};
    this.rgba = new Uint8Array(0);
    this.width = this.height = 0;
    this.reset();
  }

  // Only a fresh video frame is sampled, at up to 15 Hz. The caller supplies
  // the exact visible camera rectangle, not one recalculated at rounded size.
  sample(now: number, stageWidth: number, stageHeight: number, rect: CameraRect, key: ChromaKeySettings, mirrored: boolean): boolean {
    if (now - this.lastSample < 1000 / 15 - 1) return false;
    const start = performance.now();
    const gl = this.gl;
    const size = getMaskSize(stageWidth, stageHeight);
    try {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
      if (size.width !== this.width || size.height !== this.height) {
        this.width = size.width;
        this.height = size.height;
        this.rgba = new Uint8Array(this.width * this.height * 4);
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.width, this.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture, 0);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error("The interaction mask render target is unavailable.");
      }
      gl.viewport(0, 0, this.width, this.height);
      gl.disable(gl.BLEND);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.activeTexture(gl.TEXTURE0);
      gl.useProgram(this.program);
      gl.uniform1i(this.uniforms.camera, 0);
      gl.uniform4f(this.uniforms.rect, rect.x, rect.y, rect.width, rect.height);
      gl.uniform1i(this.uniforms.mirrored, mirrored ? 1 : 0);
      gl.uniform1i(this.uniforms.keyEnabled, key.enabled ? 1 : 0);
      gl.uniform3f(this.uniforms.keyColor, ...key.color);
      gl.uniform1f(this.uniforms.tolerance, key.tolerance);
      gl.uniform1f(this.uniforms.softness, key.softness);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const readStart = performance.now();
      gl.readPixels(0, 0, this.width, this.height, gl.RGBA, gl.UNSIGNED_BYTE, this.rgba);
      this.readbackMs = performance.now() - readStart;
      this.mask.update(this.rgba, this.width, this.height, now);
      this.sampleMs = performance.now() - start;
      this.lastSample = now;
      return true;
    } finally {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, stageWidth, stageHeight);
    }
  }
}
