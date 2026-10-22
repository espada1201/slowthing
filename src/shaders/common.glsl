// Spectral Doppler lookup (see src/physics/spectrum.ts) and display transform, shared by every world.
uniform sampler2D uLut;
uniform float uLutSize;
uniform float uLutRange;

// Where D lies on the grid of ln D that the Doppler LUT and the tables built on its grid share (physics/spectrum.ts
// lutD): between entries i0 and i1, a fraction f of the way. Beyond the grid it holds the edge entry.
void lutCell(float D, out int i0, out int i1, out float f) {
  float x = clamp((log(max(D, 1e-6)) + uLutRange) / (2.0 * uLutRange), 0.0, 1.0) * (uLutSize - 1.0);
  i0 = int(floor(x));
  i1 = min(i0 + 1, int(uLutSize) - 1);
  f = fract(x);
}

// The 300 K glow of a surface seen with Doppler factor D, in linear RGB: the alpha of the LUT's three rows. Not
// clamped, as dopplerShift adds it to the reflected colour before clamping.
vec3 thermalGlow(float D) {
  int i0, i1;
  float f;
  lutCell(D, i0, i1, f);
  return vec3(
    mix(texelFetch(uLut, ivec2(i0, 0), 0).a, texelFetch(uLut, ivec2(i1, 0), 0).a, f),
    mix(texelFetch(uLut, ivec2(i0, 1), 0).a, texelFetch(uLut, ivec2(i1, 1), 0).a, f),
    mix(texelFetch(uLut, ivec2(i0, 2), 0).a, texelFetch(uLut, ivec2(i1, 2), 0).a, f));
}

// Observed linear RGB for a surface of colour rgb seen with Doppler factor D (no beaming).
// thermal = 1 adds the 300 K glow that a strong blueshift drags into the visible.
// Beyond the table (|ln D| > uLutRange) it holds the edge colour, so a source shifted further still shows
// (and D⁵ beaming makes it blaze) instead of turning black.
vec3 dopplerShift(vec3 rgb, float D, float thermal) {
  int i0, i1;
  float f;
  lutCell(D, i0, i1, f);
  vec3 r = mix(texelFetch(uLut, ivec2(i0, 0), 0).rgb, texelFetch(uLut, ivec2(i1, 0), 0).rgb, f);
  vec3 g = mix(texelFetch(uLut, ivec2(i0, 1), 0).rgb, texelFetch(uLut, ivec2(i1, 1), 0).rgb, f);
  vec3 b = mix(texelFetch(uLut, ivec2(i0, 2), 0).rgb, texelFetch(uLut, ivec2(i1, 2), 0).rgb, f);
  return max(rgb.r * r + rgb.g * g + rgb.b * b + thermal * thermalGlow(D), 0.0);
}

// Identity below 0.8, smooth roll-off above: keeps scene colours true while beaming saturates gracefully.
vec3 softClip(vec3 c) {
  vec3 over = max(c - 0.8, 0.0);
  vec3 rolled = 0.8 + 0.2 * (1.0 - exp(-over / 0.2));
  vec3 outc = mix(c, rolled, step(0.8, c));
  // Bleed extreme brightness into white so a blinding source reads as light, not flat colour.
  float peak = max(max(c.r, c.g), c.b);
  return mix(outc, vec3(1.0), clamp((peak - 1.5) / 6.0, 0.0, 0.85));
}

vec3 linearToSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
