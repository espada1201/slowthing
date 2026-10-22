// The lighting World I's still and moving surfaces share, in the frame the surface is at rest in.
varying vec3 vColor;
varying vec3 vNormal;
varying vec3 vWorld;
varying float vPattern;

struct Lit {
  vec3 n;          // the normal, turned towards the eye
  vec3 sunlit;     // the sunlight the surface reflects
  vec3 skylit;     // the sky light it reflects
  float emissive;  // above 0 for a lamp, which glows instead
  vec3 col;        // the colour it sends out: the glow, or both reflections
};

// Lit by the sun from direction `sun`; a blinking lamp at `blinkPhase` (0 to 1) through its period.
Lit lightSurface(vec3 sun, float blinkPhase) {
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
    emissive = 0.7 + 3.0 * exp(-blinkPhase * 9.0);
  }
  float diff = max(dot(n, sun), 0.0);
  float hemi = 0.5 + 0.5 * n.y;
  vec3 ambient = mix(vec3(0.32, 0.28, 0.24), vec3(0.55, 0.66, 0.82), hemi);
  float ao = mix(0.72, 1.0, smoothstep(0.0, 2.5, vWorld.y));
  vec3 sunlit = albedo * diff * vec3(1.0, 0.95, 0.86) * 0.9 * ao;
  vec3 skylit = albedo * ambient * 0.42 * ao;
  return Lit(n, sunlit, skylit, emissive, emissive > 0.0 ? vColor * 2.4 * emissive : sunlit + skylit);
}
