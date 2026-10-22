uniform vec3 uSun;
varying vec3 vDir;

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(vec3(0.80, 0.80, 0.76), vec3(0.16, 0.36, 0.70), pow(clamp(h, 0.0, 1.0), 0.55));
  if (h < 0.0) col = mix(vec3(0.80, 0.80, 0.76), vec3(0.42, 0.40, 0.36), clamp(-h * 6.0, 0.0, 1.0));
  float s = max(dot(d, uSun), 0.0);
  col += vec3(1.0, 0.85, 0.6) * pow(s, 60.0) * 0.5 + vec3(1.0, 0.97, 0.9) * smoothstep(0.9994, 0.9997, s) * 4.0;
  col = min(col, vec3(1.0));
  gl_FragColor = vec4(mix(col * 12.92, 1.055 * pow(col, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, col)), 1.0);
}
