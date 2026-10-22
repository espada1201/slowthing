// Reflected light (src/physics/spectrum.ts reflectionKnots). Light is carried as its spectrum at the eye, relative to
// sunlight at rest, at the KNOTS wavelengths KNOT_LAMBDA; a surface's reflectance windows shift by dR on the way to the
// eye. Needs physics/skylight.ts TABLES_GLSL, and common.glsl's lutCell: the table is on the Doppler LUT's grid of ln dR.
uniform sampler2D uKnots;

// Sunlight at λ nm relative to SUN_REF_NM, a black body whose exponent is SUN_HC_KT_NM / λ (SUN_NORM normalises it).
float sunlight(float lambda) {
  float r = SUN_REF_NM / lambda;
  return r * r * r * r * r * SUN_NORM / (exp(min(SUN_HC_KT_NM / lambda, 80.0)) - 1.0);
}

// Observed linear RGB of the light reflected off a surface whose reflectance shifts by dR on its way to the eye:
// Σ_p K_p(dR) · light[p], where light[p] is the light at knot p times the surface colour it falls on (lights of
// different colours add per knot).
vec3 reflectKnots(float dR, vec3 light[KNOTS]) {
  int i0, i1;
  float f;
  lutCell(dR, i0, i1, f);
  vec3 c = vec3(0.0);
  for (int p = 0; p < KNOTS; p++) {
    for (int k = 0; k < 3; k++) {
      int row = 3 * p + k;
      c += light[p][k] * mix(texelFetch(uKnots, ivec2(i0, row), 0).rgb, texelFetch(uKnots, ivec2(i1, row), 0).rgb, f);
    }
  }
  return max(c, 0.0);
}
