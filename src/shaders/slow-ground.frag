uniform vec3 uSun;
uniform float uTrackRadius;
varying vec3 vWorld;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float grid(vec2 p, float width) {
  vec2 w = fwidth(p);
  vec2 f = abs(fract(p) - 0.5);
  vec2 l = smoothstep(vec2(width) + w, vec2(width), 0.5 - f);
  return max(l.x, l.y);
}

void main() {
  vec2 p = vWorld.xz;
  float r = length(p);
  vec3 stone = vec3(0.72, 0.66, 0.56) * (0.9 + 0.1 * hash(floor(p / 2.0)));
  vec3 grass = vec3(0.30, 0.42, 0.20) * (0.8 + 0.35 * noise(p * 0.35));
  float plaza = smoothstep(uTrackRadius + 4.0, uTrackRadius + 3.0, r);
  vec3 col = mix(grass, stone, plaza);
  col = mix(col, col * 0.62, grid(p / 2.0, 0.03) * plaza);
  col = mix(col, vec3(0.86, 0.80, 0.68), grid(p / 10.0, 0.012) * plaza);
  // Tram track: ballast, sleepers, two rails.
  float dr = abs(r - uTrackRadius);
  col = mix(col, vec3(0.45, 0.42, 0.40), smoothstep(1.9, 1.7, dr));
  float ang = atan(p.y, p.x) * uTrackRadius;
  float sleeper = step(abs(fract(ang / 1.1) - 0.5), 0.18) * step(dr, 1.3);
  col = mix(col, vec3(0.35, 0.25, 0.18), sleeper);
  float rail = smoothstep(0.11, 0.06, abs(dr - 0.72));
  col = mix(col, vec3(0.2, 0.2, 0.22), rail);
  float diff = max(uSun.y, 0.0);
  col *= diff * vec3(1.0, 0.95, 0.86) * 0.9 + vec3(0.5, 0.55, 0.6) * 0.42;
  gl_FragColor = vec4(col, 1.0);
}
