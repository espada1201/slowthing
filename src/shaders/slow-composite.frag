// What a moving observer actually sees: aberrate each screen ray into the scenery frame, look it up in
// the rest-frame cube map, then apply the Doppler colour shift and D⁵ searchlight beaming.
uniform samplerCube uCube;
uniform vec3 uBeta;
uniform mat3 uCamRot;
uniform vec2 uTan;
uniform float uAberration;
uniform float uDoppler;
uniform float uBeaming;
uniform float uExposure;
varying vec2 vUv;

vec3 observerToWorld(vec3 n, vec3 beta) {
  float b = length(beta);
  if (b < 1e-6) return n;
  vec3 bh = beta / b;
  float g = 1.0 / sqrt(1.0 - b * b);
  float par = dot(n, bh);
  vec3 perp = n - bh * par;
  float den = 1.0 - dot(beta, n);
  return normalize(bh * (par - b) / den + perp / (g * den));
}

void main() {
  vec3 nObs = normalize(uCamRot * vec3((vUv.x * 2.0 - 1.0) * uTan.x, (vUv.y * 2.0 - 1.0) * uTan.y, -1.0));
  vec3 nW = uAberration > 0.5 ? observerToWorld(nObs, uBeta) : nObs;
  vec4 s = texture(uCube, nW);
  float g = 1.0 / sqrt(1.0 - dot(uBeta, uBeta));
  float D = g * (1.0 + dot(uBeta, nW)) * s.a;
  vec3 col = uDoppler > 0.5 ? dopplerShift(s.rgb, D, 1.0) : s.rgb;
  if (uBeaming > 0.5) col *= pow(D, 5.0);
  col *= uExposure;
  gl_FragColor = vec4(linearToSRGB(softClip(col)), 1.0);
}
