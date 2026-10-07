const VERTEX = `#version 300 es
out vec2 v_uv;
void main() {
  // A fullscreen triangle, with no vertex buffer or per-frame geometry upload.
  vec2 uv = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  v_uv = uv;
  gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
}`;

export function createProgram(gl: WebGL2RenderingContext, fragmentSource: string): WebGLProgram {
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
