// Reflected light (src/physics/spectrum.ts reflectionKnots). Light is carried as its spectrum at the eye, relative to
// sunlight at rest, at KNOTS wavelengths λ_p = 380·e^{0.15(p − 1)} nm; a surface's reflectance windows shift by dR on
// the way to the eye. Needs common.glsl: the table shares the Doppler LUT's grid of ln dR.
uniform sampler2D uKnots;
const int KNOTS = 8;

float knotLambda(int p) {
  return 380.0 * exp(0.15 * float(p - 1));
}

// Sunlight at λ nm relative to 550 nm, a 5778 K black body: hc/(kT) = 2490.094977 nm, e^{hc/(kT·550 nm)} − 1 = 91.52190359.
float sunlight(float lambda) {
  float r = 550.0 / lambda;
  return r * r * r * r * r * 91.52190359 / (exp(min(2490.094977 / lambda, 80.0)) - 1.0);
}

// Observed linear RGB of the light reflected off a surface whose reflectance shifts by dR on its way to the eye:
// Σ_p K_p(dR) · light[p], where light[p] is the light at knot p times the surface colour it falls on (lights of
// different colours add per knot).
vec3 reflectKnots(float dR, vec3 light[KNOTS]) {
  float x = clamp((log(max(dR, 1e-6)) + uLutRange) / (2.0 * uLutRange), 0.0, 1.0) * (uLutSize - 1.0);
  int i0 = int(floor(x));
  int i1 = min(i0 + 1, int(uLutSize) - 1);
  float f = fract(x);
  vec3 c = vec3(0.0);
  for (int p = 0; p < KNOTS; p++) {
    for (int k = 0; k < 3; k++) {
      int row = 3 * p + k;
      c += light[p][k] * mix(texelFetch(uKnots, ivec2(i0, row), 0).rgb, texelFetch(uKnots, ivec2(i1, row), 0).rgb, f);
    }
  }
  return max(c, 0.0);
}
