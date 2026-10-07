// One background pass, no frame-by-frame CPU animation or extra render loop.
export const SCENE_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_scene;
uniform vec2 u_uvScale;
uniform vec2 u_size;
uniform bool u_animated;
uniform float u_time;
out vec4 color;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float ellipse(vec2 p, vec2 radius) {
  return 1.0 - smoothstep(0.85, 1.0, length(p / radius));
}
float stars(vec2 p, float density, float drift) {
  vec2 grid = (p + vec2(u_time * drift, 0.0)) * density;
  vec2 cell = floor(grid);
  float seed = hash(cell);
  vec2 center = vec2(0.2) + vec2(seed, hash(cell + 9.0)) * 0.6;
  float sparkle = 0.65 + 0.35 * sin(u_time * (0.6 + seed) + seed * 60.0);
  float point = 1.0 - smoothstep(0.015, 0.06, length(fract(grid) - center));
  return point * sparkle * step(0.68, seed);
}
float meteor(vec2 p, float offset, float height) {
  float phase = mod(u_time + offset, 13.0);
  float progress = clamp((phase - 8.0) / 1.4, 0.0, 1.0);
  vec2 head = vec2(mix(-0.2, 1.2, progress), height - progress * 0.32);
  vec2 delta = p - head;
  vec2 direction = normalize(vec2(1.4, -0.32));
  float along = dot(delta, direction);
  float across = abs(dot(delta, vec2(-direction.y, direction.x)));
  float tail = (1.0 - smoothstep(0.001, 0.004, across))
    * smoothstep(-0.22, 0.0, along) * (1.0 - step(0.0, along));
  return (tail + ellipse(delta, vec2(0.005))) * step(8.0, phase) * (1.0 - step(9.4, phase));
}
void main() {
  if (!u_animated) {
    vec2 uv = (v_uv - 0.5) * u_uvScale + 0.5;
    color = vec4(texture(u_scene, vec2(uv.x, 1.0 - uv.y)).rgb, 1.0);
    return;
  }
  // Aspect-independent coordinates keep stars and the ship round on phones.
  vec2 p = (v_uv - 0.5) * u_size / min(u_size.x, u_size.y);
  float cloud = sin(p.x * 3.0 + p.y * 2.0 + u_time * 0.025)
    * sin(p.y * 4.0 - p.x + u_time * 0.018);
  vec3 rgb = mix(vec3(0.018, 0.025, 0.085), vec3(0.15, 0.065, 0.28), cloud * 0.5 + 0.5);
  float ribbon = (p.y + p.x * 0.4 + sin(p.x * 2.5 + u_time * 0.012) * 0.18) * 3.0;
  float wisps = 0.65 + 0.35 * sin(p.x * 9.0 - p.y * 7.0 + sin(p.x * 4.0) + u_time * 0.02);
  rgb += mix(vec3(0.04, 0.13, 0.22), vec3(0.24, 0.08, 0.20), sin(p.x * 1.8) * 0.5 + 0.5)
    * exp(-ribbon * ribbon) * wisps;
  rgb += vec3(0.70, 0.86, 1.0) * stars(p, 34.0, 0.0015);
  rgb += vec3(1.0, 0.78, 0.60) * stars(p, 18.0, 0.003);
  rgb += vec3(0.6, 0.85, 1.0) * (meteor(v_uv, 0.0, 0.86) + meteor(v_uv, 5.5, 0.72));

  // A friendly little saucer cruises through every 32 seconds, first at 4s.
  float phase = mod(u_time, 32.0);
  float progress = clamp((phase - 4.0) / 7.0, 0.0, 1.0);
  vec2 center = vec2(mix(-0.15, 1.15, progress), 0.62 + sin(progress * 6.283) * 0.065);
  vec2 ship = (v_uv - center) * u_size / min(u_size.x, u_size.y);
  float visible = step(4.0, phase) * (1.0 - step(11.0, phase));
  rgb += vec3(0.10, 0.45, 0.65) * ellipse(ship + vec2(0.058, 0.0), vec2(0.06, 0.009)) * visible;
  float dome = ellipse(ship - vec2(0.0, 0.018), vec2(0.023, 0.027)) * visible;
  rgb = mix(rgb, vec3(0.38, 0.83, 0.94), dome);
  float hull = ellipse(ship, vec2(0.053, 0.014)) * visible;
  rgb = mix(rgb, vec3(0.72, 0.68, 0.94) + ship.y * 9.0, hull);
  float lights = ellipse(ship + vec2(0.028, 0.0), vec2(0.004))
    + ellipse(ship, vec2(0.004)) + ellipse(ship - vec2(0.028, 0.0), vec2(0.004));
  rgb += vec3(1.0, 0.77, 0.28) * lights * visible;
  color = vec4(rgb, 1.0);
}`;
