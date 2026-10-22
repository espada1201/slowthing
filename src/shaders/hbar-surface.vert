// |ψ|² as a luminous sheet floating over the floor: height and opacity follow the probability density.
uniform sampler2D uState;
uniform int uN;
uniform float uPeak;
uniform float uHeight;
varying float vI;
varying vec2 vPsi;

void main() {
  vec3 p = position;
  ivec2 c = clamp(ivec2((p.xz + 24.0) / 48.0 * float(uN)), ivec2(0), ivec2(uN - 1));
  vec4 s = texelFetch(uState, c, 0);
  vI = waveLevel(max(s.r * s.r + s.g * s.b, 0.0), uPeak);
  vPsi = s.rg;
  // The sheet ripples a little with Re ψ, so the crests stand up as well as shine.
  p.y += 0.03 + vI * uHeight * (0.8 + 0.2 * s.r / max(length(s.rg), 1e-12));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
