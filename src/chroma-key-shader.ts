// Chromaticity compares color ratios rather than raw brightness, allowing
// the same blanket hue to key through moderate shadows and wrinkles.
export const CAMERA_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_camera;
uniform vec4 u_rect;
uniform bool u_mirrored;
uniform bool u_keyEnabled;
uniform vec3 u_keyColor;
uniform float u_tolerance;
uniform float u_softness;
uniform float u_despill;
uniform bool u_showMask;
out vec4 color;
vec3 chroma(vec3 rgb) {
  return rgb / max(rgb.r + rgb.g + rgb.b, 0.001);
}
void main() {
  vec2 uv = (v_uv - u_rect.xy) / u_rect.zw;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) discard;
  // Video rows start at the top; stage y points up.
  uv.y = 1.0 - uv.y;
  if (u_mirrored) uv.x = 1.0 - uv.x;
  vec3 rgb = texture(u_camera, uv).rgb;
  if (!u_keyEnabled) {
    color = vec4(rgb, 1.0);
    return;
  }
  float distanceToKey = length(chroma(rgb) - chroma(u_keyColor));
  float alpha = smoothstep(u_tolerance, u_tolerance + max(u_softness, 0.001), distanceToKey);
  if (u_showMask) {
    color = vec4(vec3(alpha), 1.0);
    return;
  }
  // Suppress only excess green, near the key hue. Neutral/skin colors stay
  // intact. Green spill suppression is inactive for a non-green key color.
  float greenKey = step(max(u_keyColor.r, u_keyColor.b) + 0.01, u_keyColor.g);
  float fringe = 1.0 - smoothstep(u_tolerance, u_tolerance + u_softness + 0.2, distanceToKey);
  rgb.g -= max(0.0, rgb.g - max(rgb.r, rgb.b)) * u_despill * fringe * greenKey;
  color = vec4(rgb, alpha);
}`;
