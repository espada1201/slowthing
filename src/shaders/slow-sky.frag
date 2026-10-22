uniform vec3 uSun;
uniform vec3 uObs;
varying vec3 vWorld;

float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; }
  return s;
}

void main() {
  vec3 d = normalize(vWorld - uObs);
  float h = d.y;
  vec3 zenith = vec3(0.16, 0.36, 0.70);
  vec3 horizon = vec3(0.80, 0.80, 0.76);
  vec3 col = mix(horizon, zenith, pow(clamp(h, 0.0, 1.0), 0.55));
  if (h < 0.0) col = mix(horizon, vec3(0.42, 0.40, 0.36), clamp(-h * 6.0, 0.0, 1.0));
  if (h > 0.02) {
    vec2 uv = d.xz / (h + 0.12) * 1.6;
    float c = smoothstep(0.5, 0.85, fbm(uv + 3.0));
    col = mix(col, vec3(0.95, 0.94, 0.92), c * 0.8 * smoothstep(0.02, 0.2, h));
  }
  float s = max(dot(d, uSun), 0.0);
  col += vec3(1.0, 0.85, 0.6) * pow(s, 60.0) * 0.6;
  col += vec3(1.0, 0.97, 0.9) * smoothstep(0.9994, 0.9997, s) * 12.0;
  gl_FragColor = vec4(col, 1.0);
}
