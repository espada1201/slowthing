// The wave as warm light, linear RGB: brightness follows |ψ|², and the crests of Re ψ shimmer through
// it so the wavelength and the direction of travel stay visible.
vec3 waveColour(vec2 psi, float level) {
  vec3 c = mix(vec3(0.644, 0.058, 0.024), vec3(0.93, 0.42, 0.09), smoothstep(0.1, 0.55, level));
  c = mix(c, vec3(1.0, 0.88, 0.66), smoothstep(0.55, 1.0, level));
  return c * (0.6 + 0.4 * psi.x / max(length(psi), 1e-12));
}

// |ψ|² against the wave's current peak on a log scale, so a fringe at 1% of the peak still shows.
float waveLevel(float rho, float peak) {
  return clamp(log(1.0 + rho / (0.02 * peak)) / log(51.0), 0.0, 1.0);
}
