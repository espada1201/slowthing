// Moving objects, shaded all the way to the eye (TABLES_GLSL, common.glsl, boost.glsl, reflect.glsl and
// slow-surface.glsl prepended): lit in their own frame, then shifted on the way to the eye.
uniform float uBlinkPeriod;
uniform float uBeta;
uniform vec3 uObs;
uniform vec3 uObsBeta;    // the observer's velocity / c
uniform float uDopplerOn;
uniform float uBeamingOn;
uniform sampler2D uSky;
varying float vDsrc;
varying float vTau;
varying float vDin;
varying vec3 vSunLocal;
varying vec3 vVelocity;

const float PI = 3.14159265;

vec2 skyCell(float x, float eta) {
  return vec2(acos(clamp(x, -1.0, 1.0)) / PI * float(SKY_X - 1), clamp(eta / SKY_RAPIDITY_MAX, 0.0, 1.0) * float(SKY_ETA - 1));
}

// Column col of the sky table (physics/skylight.ts buildSkyLUT), blended between the four face directions and
// rapidities around cell q.
vec4 skyTexel(int col, vec2 q) {
  ivec2 a = ivec2(floor(q));
  ivec2 b = min(a + 1, ivec2(SKY_X, SKY_ETA) - 1);
  vec2 g = q - vec2(a);
  vec4 lo = mix(texelFetch(uSky, ivec2(col, a.x + SKY_X * a.y), 0), texelFetch(uSky, ivec2(col, b.x + SKY_X * a.y), 0), g.x);
  vec4 hi = mix(texelFetch(uSky, ivec2(col, a.x + SKY_X * b.y), 0), texelFetch(uSky, ivec2(col, b.x + SKY_X * b.y), 0), g.x);
  return mix(lo, hi, g.y);
}

// The sky light on a face at cos x to its motion at rapidity eta, in its own frame, reflected on to the eye with
// Doppler factor dOut: its value at each knot. The table holds its logarithm on one wavelength grid; knot p of a face
// seen with D_out at node i sits at wavelength 2p + i.
void skyKnots(float dOut, float x, float eta, int setting, out float light[KNOTS]) {
  float i = clamp(log(max(dOut, 1e-6)) / SKY_STEP + float(SKY_HALF), 0.0, float(2 * SKY_HALF));
  int n0 = min(int(i), 2 * SKY_HALF - 1);
  float f = i - float(n0);
  vec2 q = skyCell(x, eta);
  float v[2 * KNOTS];
  for (int t = 0; t < KNOTS / 2; t++) {
    vec4 c = skyTexel(n0 + 4 * t + setting * SKY_TEXELS, q);
    for (int k = 0; k < 4; k++) v[4 * t + k] = c[k];
  }
  for (int p = 0; p < KNOTS; p++) light[p] = exp(mix(v[2 * p], v[2 * p + 1], f));
}

// With the colour shift off, the searchlight alone: the face's sky light relative to the sky at rest.
float skyBeam(float x, float eta) {
  return exp(skyTexel(SKY_BEAM, skyCell(x, eta)).r);
}

void main() {
  Lit s = lightSurface(normalize(vSunLocal), fract(vTau / uBlinkPeriod));
  // In its own frame a moving surface gets sunlight shifted by vDin (D³ brighter per unit wavelength, a point source)
  // and sky light bluer and brighter ahead (physics/skylight.ts); its light then reaches the eye shifted by D_out,
  // through its own motion and then the observer's.
  float dObs = dopplerFactor(normalize(vWorld - uObs), uObsBeta);
  float dOut = vDsrc * dObs;
  float x = uBeta > 1e-6 ? dot(s.n, normalize(vVelocity)) : 0.0;
  float eta = atanh(min(uBeta, 0.9999));
  bool colour = uDopplerOn > 0.5;
  bool beam = uBeamingOn > 0.5;
  float sunGain = beam ? vDin * vDin * vDin : 1.0;
  vec3 col = s.col;
  if (s.emissive > 0.0) {
    if (colour) col = dopplerShift(col, dOut, 1.0);
  } else if (colour) {
    float sky[KNOTS];
    skyKnots(dOut, x, eta, beam ? 0 : 1, sky);
    vec3 light[KNOTS];
    for (int p = 0; p < KNOTS; p++) light[p] = sunlight(KNOT_LAMBDA[p] * vDin * dOut) * sunGain * s.sunlit + sky[p] * s.skylit;
    col = reflectKnots(dOut, light) + max(thermalGlow(dOut), 0.0);
  } else if (beam) {
    col = s.sunlit * sunGain + s.skylit * skyBeam(x, eta);
  }
  if (beam) col *= pow(dOut, 5.0);
  col = min(col, vec3(6e4)); // a finite half-float in the cube map
  gl_FragColor = vec4(col, 1.0 / dObs); // alpha: see slow-composite.frag
}
