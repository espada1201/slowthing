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
varying float vDin;
varying vec3 vSunLocal;
varying vec3 vVelocity;
uniform float uBeta;
uniform float uDopplerOn;
uniform float uBeamingOn;
uniform sampler2D uIllum;
uniform float uIllumSize;
uniform float uIllumRange;
uniform sampler2D uSky;
uniform vec3 uSkySize;    // samples of cos(normal, motion), samples of rapidity, top rapidity

// A moving surface is lit in its own frame, where light arriving with Doppler factor D has its spectrum shifted
// (physics/reflection.ts, D_R = 1, D_S = D) and its flux scaled by D³ per wavelength.
vec3 shiftedLight(vec3 rgb, float D) {
  vec3 c = rgb;
  if (uDopplerOn > 0.5) {
    float x = clamp((log(D) + uIllumRange) / (2.0 * uIllumRange), 0.0, 1.0) * (uIllumSize - 1.0);
    int i0 = int(floor(x));
    int i1 = min(i0 + 1, int(uIllumSize) - 1);
    float f = fract(x);
    vec3 r = mix(texelFetch(uIllum, ivec2(i0, 0), 0).rgb, texelFetch(uIllum, ivec2(i1, 0), 0).rgb, f);
    vec3 g = mix(texelFetch(uIllum, ivec2(i0, 1), 0).rgb, texelFetch(uIllum, ivec2(i1, 1), 0).rgb, f);
    vec3 b = mix(texelFetch(uIllum, ivec2(i0, 2), 0).rgb, texelFetch(uIllum, ivec2(i1, 2), 0).rgb, f);
    c = max(rgb.r * r + rgb.g * g + rgb.b * b, 0.0);
  }
  return uBeamingOn > 0.5 ? c * D * D * D : c;
}

vec3 skyTexel(int row, vec2 p) {
  ivec2 i = ivec2(floor(p));
  vec2 f = fract(p);
  int x1 = min(i.x + 1, int(uSkySize.x) - 1);
  int y0 = row * int(uSkySize.y) + i.y;
  int y1 = row * int(uSkySize.y) + min(i.y + 1, int(uSkySize.y) - 1);
  vec3 lo = mix(texelFetch(uSky, ivec2(i.x, y0), 0).rgb, texelFetch(uSky, ivec2(x1, y0), 0).rgb, f.x);
  vec3 hi = mix(texelFetch(uSky, ivec2(i.x, y1), 0).rgb, texelFetch(uSky, ivec2(x1, y1), 0).rgb, f.x);
  return mix(lo, hi, f.y);
}

// Sky light on a moving surface, integrated over its view of the sky in its own frame (physics/reflection.ts):
// the sky ahead arrives bluer and brighter, the sky behind redder and dimmer.
vec3 skyLight(vec3 rgb, vec3 n) {
  bool colour = uDopplerOn > 0.5;
  bool beam = uBeamingOn > 0.5;
  if (!colour && !beam) return rgb;
  float x = uBeta > 1e-4 ? clamp(dot(n, vVelocity) / uBeta, -1.0, 1.0) : 0.0;
  vec2 p = vec2((x * 0.5 + 0.5) * (uSkySize.x - 1.0), clamp(atanh(uBeta) / uSkySize.z, 0.0, 1.0) * (uSkySize.y - 1.0));
  if (!colour) return rgb * skyTexel(6, p).r;
  int r = beam ? 0 : 3;
  return max(rgb.r * skyTexel(r, p) + rgb.g * skyTexel(r + 1, p) + rgb.b * skyTexel(r + 2, p), 0.0);
}
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
  vec3 sun = uSun;
#ifdef MOVING
  sun = vSunLocal;
#endif
  float diff = max(dot(n, sun), 0.0);
  float hemi = 0.5 + 0.5 * n.y;
  vec3 ambient = mix(vec3(0.32, 0.28, 0.24), vec3(0.55, 0.66, 0.82), hemi);
  float ao = mix(0.72, 1.0, smoothstep(0.0, 2.5, vWorld.y));
  vec3 sunlit = albedo * diff * vec3(1.0, 0.95, 0.86) * 0.9;
  vec3 skylit = albedo * ambient * 0.42;
#ifdef MOVING
  sunlit = shiftedLight(sunlit, vDin);
  skylit = skyLight(skylit, n);
#endif
  vec3 col = (sunlit + skylit) * ao;
  if (emissive > 0.0) col = vColor * 2.4 * emissive;
  float dsrc = 1.0;
#ifdef MOVING
  dsrc = vDsrc;
#endif
  gl_FragColor = vec4(col, dsrc);
}
