// Lit surface colour in the scenery's rest frame. Alpha carries the source Doppler factor, which the composite
// combines with the observer's own. Moving objects (MOVING, with common.glsl and reflect.glsl prepended) are shaded
// all the way to the eye instead, and write alpha = 1 / (the observer's factor) so the composite shifts them no further.
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
uniform vec3 uObs;
uniform vec3 uObsBeta;    // the observer's velocity / c
uniform float uDopplerOn;
uniform float uBeamingOn;
uniform sampler2D uSky;
uniform sampler2D uSkyBeam;
uniform vec4 uSkySize;    // face directions, rapidities, top rapidity, texels per searchlight setting
uniform vec2 uSkyGrid;    // ln D_out per wavelength step, D_out nodes either side of 1

const float PI = 3.14159265;

vec2 skyCell(float x, float eta) {
  return vec2(acos(clamp(x, -1.0, 1.0)) / PI * (uSkySize.x - 1.0), clamp(eta / uSkySize.z, 0.0, 1.0) * (uSkySize.y - 1.0));
}

// The sky light on a face at cos x to its motion at rapidity eta, in its own frame, reflected on to the eye with
// Doppler factor dOut: its value at each knot (physics/skylight.ts buildSkyLUT). The table holds its logarithm on one
// wavelength grid; knot p of a face seen with D_out at node i sits at wavelength 2p + i.
void skyKnots(float dOut, float x, float eta, int setting, out float light[KNOTS]) {
  float i = clamp(log(max(dOut, 1e-6)) / uSkyGrid.x + uSkyGrid.y, 0.0, 2.0 * uSkyGrid.y);
  int n0 = min(int(i), int(2.0 * uSkyGrid.y) - 1);
  float f = i - float(n0);
  vec2 q = skyCell(x, eta);
  ivec2 a = ivec2(floor(q));
  ivec2 b = min(a + 1, ivec2(uSkySize.xy) - 1);
  vec2 g = q - vec2(a);
  int nx = int(uSkySize.x);
  float v[16];
  for (int t = 0; t < 4; t++) {
    int col = n0 + 4 * t + setting * int(uSkySize.w);
    vec4 lo = mix(texelFetch(uSky, ivec2(col, a.x + nx * a.y), 0), texelFetch(uSky, ivec2(col, b.x + nx * a.y), 0), g.x);
    vec4 hi = mix(texelFetch(uSky, ivec2(col, a.x + nx * b.y), 0), texelFetch(uSky, ivec2(col, b.x + nx * b.y), 0), g.x);
    vec4 c = mix(lo, hi, g.y);
    for (int k = 0; k < 4; k++) v[4 * t + k] = c[k];
  }
  for (int p = 0; p < KNOTS; p++) light[p] = exp(mix(v[2 * p], v[2 * p + 1], f));
}

// With the colour shift off, the searchlight alone: the face's sky light relative to the sky at rest.
float skyBeam(float x, float eta) {
  vec2 q = skyCell(x, eta);
  ivec2 a = ivec2(floor(q));
  ivec2 b = min(a + 1, ivec2(uSkySize.xy) - 1);
  vec2 g = q - vec2(a);
  float lo = mix(texelFetch(uSkyBeam, a, 0).r, texelFetch(uSkyBeam, ivec2(b.x, a.y), 0).r, g.x);
  float hi = mix(texelFetch(uSkyBeam, ivec2(a.x, b.y), 0).r, texelFetch(uSkyBeam, b, 0).r, g.x);
  return exp(mix(lo, hi, g.y));
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
  sun = normalize(vSunLocal);
#endif
  float diff = max(dot(n, sun), 0.0);
  float hemi = 0.5 + 0.5 * n.y;
  vec3 ambient = mix(vec3(0.32, 0.28, 0.24), vec3(0.55, 0.66, 0.82), hemi);
  float ao = mix(0.72, 1.0, smoothstep(0.0, 2.5, vWorld.y));
  vec3 sunlit = albedo * diff * vec3(1.0, 0.95, 0.86) * 0.9 * ao;
  vec3 skylit = albedo * ambient * 0.42 * ao;
  vec3 col = emissive > 0.0 ? vColor * 2.4 * emissive : sunlit + skylit;
  float alpha = 1.0;
#ifdef MOVING
  // In its own frame a moving surface gets sunlight shifted by vDin (D³ brighter per unit wavelength, a point source)
  // and sky light bluer and brighter ahead (physics/skylight.ts); its light then reaches the eye shifted by D_out,
  // through its own motion and then the observer's.
  float dObs = inversesqrt(1.0 - dot(uObsBeta, uObsBeta)) * (1.0 + dot(uObsBeta, normalize(vWorld - uObs)));
  float dOut = vDsrc * dObs;
  float x = uBeta > 1e-6 ? dot(n, normalize(vVelocity)) : 0.0;
  float eta = atanh(min(uBeta, 0.9999));
  bool colour = uDopplerOn > 0.5;
  bool beam = uBeamingOn > 0.5;
  float sunGain = beam ? vDin * vDin * vDin : 1.0;
  if (emissive > 0.0) {
    if (colour) col = dopplerShift(col, dOut, 1.0);
  } else if (colour) {
    float sky[KNOTS];
    skyKnots(dOut, x, eta, beam ? 0 : 1, sky);
    vec3 light[KNOTS];
    for (int p = 0; p < KNOTS; p++) light[p] = sunlight(knotLambda(p) * vDin * dOut) * sunGain * sunlit + sky[p] * skylit;
    col = reflectKnots(dOut, light) + dopplerShift(vec3(0.0), dOut, 1.0);
  } else if (beam) {
    col = sunlit * sunGain + skylit * skyBeam(x, eta);
  }
  if (beam) col *= pow(dOut, 5.0);
  col = min(col, vec3(6e4)); // a finite half-float in the cube map
  alpha = 1.0 / dObs;
#endif
  gl_FragColor = vec4(col, alpha);
}
