uniform float uWave;
uniform float uSheet;
varying float vI;
varying vec2 vPsi;

void main() {
  if (vI < 0.2 || uWave < 0.5) discard;
  vec3 c = waveColour(vPsi, vI) * (0.5 + 0.9 * vI);
  c = mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  gl_FragColor = vec4(min(c, 1.0), smoothstep(0.2, 0.5, vI) * (0.15 + 0.45 * vI) * uSheet);
}
