// Injected into the courtyard floor's material: stone paving, dark absorbing margins, and the wave
// itself on the floor (strength = |ψ|² against its peak, with the crests of Re ψ showing through).
uniform sampler2D uState;
uniform sampler2D uPot;
uniform int uN;
uniform float uPeak;
uniform float uWave;
varying vec2 vFieldPos;

vec4 waveCell(ivec2 p) {
  return texelFetch(uState, clamp(p, ivec2(0), ivec2(uN - 1)), 0);
}

float tileHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void floorPattern(inout vec3 col) {
  vec2 t = vFieldPos / 1.5;
  vec2 w = fwidth(t);
  vec2 f = abs(fract(t) - 0.5);
  // Box-filtered joints that fade out, rather than widen, once they are thinner than a pixel.
  vec2 l = (1.0 - smoothstep(vec2(0.035) - 0.5 * w, vec2(0.035) + 0.5 * w, 0.5 - f)) * (1.0 - smoothstep(vec2(0.035), vec2(0.2), w));
  col *= mix(0.84 + 0.2 * tileHash(floor(t)), 0.62, max(l.x, l.y));
  ivec2 c = ivec2(floor((vFieldPos + 24.0) / 48.0 * float(uN)));
  vec4 pot = texelFetch(uPot, clamp(c, ivec2(0), ivec2(uN - 1)), 0);
  col = mix(col, vec3(0.045, 0.05, 0.06), clamp(sqrt(pot.b / 12.0), 0.0, 1.0) * 0.88);
  col = mix(col, vec3(0.35, 0.62, 0.6), step(0.001, pot.r) * 0.5);
}

// ψ at this point of the floor, bilinear between cells: xy = (Re, Im), z = brightness level.
vec3 waveSample() {
  vec2 g = (vFieldPos + 24.0) / 48.0 * float(uN) - 0.5;
  ivec2 i0 = ivec2(floor(g));
  vec2 f = fract(g);
  vec4 s = mix(mix(waveCell(i0), waveCell(i0 + ivec2(1, 0)), f.x), mix(waveCell(i0 + ivec2(0, 1)), waveCell(i0 + ivec2(1, 1)), f.x), f.y);
  return vec3(s.rg, waveLevel(max(s.r * s.r + s.g * s.b, 0.0), uPeak) * uWave);
}

// Where the wave is, the stone is stained vermilion like ink, crests a shade deeper; where it is strong
// it also glows, so it reads both in full sun and in shade.
void waveInk(vec3 w, inout vec3 col) {
  float ink = smoothstep(0.04, 0.6, w.z) * (0.8 + 0.2 * w.x / max(length(w.xy), 1e-12));
  col *= mix(vec3(1.0), vec3(0.82, 0.3, 0.17), 0.75 * ink);
}

vec3 waveLight(vec3 w) {
  return waveColour(w.xy, w.z) * smoothstep(0.25, 1.0, w.z) * 1.8;
}
