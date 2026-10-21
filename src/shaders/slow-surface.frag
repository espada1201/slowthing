// Lit surface colour in the scenery's rest frame. Alpha carries the source Doppler factor.
uniform vec3 uSun;
uniform float uBlinkPeriod;
varying vec3 vColor;
varying vec3 vNormal;
varying vec3 vWorld;
varying float vPattern;
#ifdef MOVING
varying float vDsrc;
varying float vTau;
#endif

float lineMask(float coord, float width) {
  float w = fwidth(coord);
  float f = abs(fract(coord) - 0.5);
  return smoothstep(width + w, width, 0.5 - f);
}

void main() {
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) n = -n;
  vec3 albedo = vColor;
  float emissive = 0.0;
  if (vPattern > 0.5 && vPattern < 1.5 && abs(n.y) < 0.5) {
    // Windows on building walls.
    vec2 t = vec2(dot(vWorld.xz, normalize(vec2(-n.z, n.x))) / 2.4, vWorld.y / 3.1);
    vec2 f = fract(t);
    float win = step(0.3, f.x) * step(f.x, 0.72) * step(0.35, f.y) * step(f.y, 0.78) * step(0.9, vWorld.y);
    albedo = mix(albedo, vec3(0.16, 0.2, 0.24), win);
  } else if (vPattern > 1.5 && vPattern < 2.5) {
    emissive = 1.0;
  } else if (vPattern > 2.5) {
    // Blinking lamp: a sharp flash once per proper-time period.
    float ph = 1.0;
#ifdef MOVING
    ph = fract(vTau / uBlinkPeriod);
#endif
    emissive = 0.7 + 3.0 * exp(-ph * 9.0);
  }
  float diff = max(dot(n, uSun), 0.0);
  float hemi = 0.5 + 0.5 * n.y;
  vec3 ambient = mix(vec3(0.32, 0.28, 0.24), vec3(0.55, 0.66, 0.82), hemi);
  float ao = mix(0.72, 1.0, smoothstep(0.0, 2.5, vWorld.y));
  vec3 col = albedo * (diff * vec3(1.0, 0.95, 0.86) * 0.9 + ambient * 0.42) * ao;
  if (emissive > 0.0) col = vColor * 2.4 * emissive;
  float dsrc = 1.0;
#ifdef MOVING
  dsrc = vDsrc;
#endif
  gl_FragColor = vec4(col, dsrc);
}
