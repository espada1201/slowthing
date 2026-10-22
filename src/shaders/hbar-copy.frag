// Copy an uploaded state, optionally multiplied by a Gaussian window (an unsharp position measurement).
uniform sampler2D uSrc;
uniform vec2 uCentre; // cells
uniform float uSigma; // cells; ≤ 0 means plain copy
uniform float uScale;

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 s = texelFetch(uSrc, p, 0);
  if (uSigma > 0.0) {
    vec2 d = vec2(p) - uCentre;
    s = vec4(s.rgb * exp(-dot(d, d) / (4.0 * uSigma * uSigma)) * uScale, 0.0);
  }
  gl_FragColor = s;
}
